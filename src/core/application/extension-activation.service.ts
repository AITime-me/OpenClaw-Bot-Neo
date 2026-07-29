import { createHash } from 'node:crypto';
import {
  err,
  isAllowedActivationTransition,
  ok,
  validateOperationContext,
  type ExtensionActivationState,
  type ExtensionRegistryFailure,
  type ISO8601,
  type OperationContext,
  type Result,
} from '../domain/index.js';
import type { VerifiedExtensionManifest } from '../domain/extension-manifest.internal.js';
import { isVerifiedExtensionManifest } from '../domain/extension-manifest.internal.js';
import {
  isCurrentExtensionPolicySnapshot,
  type CurrentExtensionPolicySnapshot,
} from '../domain/extension-policy.internal.js';
import {
  isDeploymentAuthorizationEvidence,
  isSealedExtensionRegistryEntry,
  isTrustedActivationDecision,
  sealActiveExtensionRegistration,
  sealDeploymentAuthorization,
  sealTrustedActivationDecision,
  type ActiveExtensionRegistration,
  type DeploymentAuthorizationEvidence,
  type SealedExtensionRegistryEntry,
} from '../domain/extension-registry-entry.internal.js';
import {
  exactPlainObservation,
  filledString,
  isFreshWindow,
  parseIsoInstant,
} from '../domain/observation-validation.js';
import type { ClockPort, ExtensionRegistryPort } from '../ports/index.js';
import type { DeploymentApprovalObservation } from '../ports/trusted-derivation.port.js';

export interface ExtensionActivationDeps {
  readonly registry: ExtensionRegistryPort;
  readonly clock: ClockPort;
}

export type ExtensionActivationFailure =
  | ExtensionRegistryFailure
  | {
      readonly code:
        | 'INVALID_OPERATION_CONTEXT'
        | 'DEPLOYMENT_UNAUTHORIZED'
        | 'RISK_DENIED'
        | 'STALE_AUTHORIZATION'
        | 'STALE_DECISION'
        | 'NOT_PENDING'
        | 'MANIFEST_MISMATCH'
        | 'POLICY_MISMATCH'
        | 'INVALID_ENTRY'
        | 'RETURNED_ENTRY_MISMATCH'
        | 'INVALID_OBSERVATION';
      readonly reason: string;
    };

export interface ExtensionActivationCommand {
  readonly pendingEntry: SealedExtensionRegistryEntry;
  readonly deploymentAuthorization: DeploymentAuthorizationEvidence;
  readonly targetState: ExtensionActivationState;
  readonly policyVersion: string;
  readonly decisionNonce: string;
}

export interface ExtensionActivationOutcome {
  readonly entry: SealedExtensionRegistryEntry;
  readonly activeRegistration: ActiveExtensionRegistration | null;
}

const sorted = (values: readonly string[]): readonly string[] => [...values].sort();

/**
 * Canonical digest over the full policy/integrity-sensitive verified manifest.
 * Caller-supplied digests are never accepted as proof.
 */
export const computeManifestDigest = (
  input: SealedExtensionRegistryEntry | VerifiedExtensionManifest,
): string => {
  const manifest: VerifiedExtensionManifest =
    'manifest' in input && isVerifiedExtensionManifest(input.manifest)
      ? input.manifest
      : (input as VerifiedExtensionManifest);
  if (!isVerifiedExtensionManifest(manifest))
    throw new TypeError('Verified extension manifest is required for digest.');
  const canonical = {
    schemaVersion: manifest.schemaVersion,
    id: manifest.id,
    version: manifest.version,
    kind: manifest.kind,
    ownerScope: {
      mode: manifest.ownerScope.mode,
      ownerReference: manifest.ownerScope.ownerReference,
    },
    provenance: {
      status: manifest.provenance.status,
      source: manifest.provenance.source,
      note: manifest.provenance.note,
    },
    enabled: manifest.enabled,
    riskClass: manifest.riskClass,
    declaredCapabilities: sorted(manifest.declaredCapabilities),
    requestedPermissions: sorted(manifest.requestedPermissions),
    approvalPolicy: {
      mode: manifest.approvalPolicy.mode,
      effects: sorted(manifest.approvalPolicy.effects),
    },
    requiredPorts: sorted(manifest.requiredPorts),
    dataClassifications: sorted(manifest.dataClassifications),
    supportedInputKinds: sorted(manifest.supportedInputKinds),
    supportedOutputKinds: sorted(manifest.supportedOutputKinds),
    configurationSchemaVersion: manifest.configurationSchemaVersion,
  };
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
};

const isFresh = (issuedAt: string, expiresAt: string, now: Date): boolean => {
  const issued = Date.parse(issuedAt);
  const expires = Date.parse(expiresAt);
  const current = now.getTime();
  return (
    Number.isFinite(issued) &&
    Number.isFinite(expires) &&
    Number.isFinite(current) &&
    expires > issued &&
    current >= issued &&
    current < expires
  );
};

const DEPLOYMENT_OBS_FIELDS = Object.freeze([
  'deploymentIdentity',
  'ownerId',
  'actorId',
  'sessionId',
  'channelId',
  'extensionId',
  'extensionVersion',
  'authorizationScope',
  'correlationId',
  'issuedAt',
  'expiresAt',
] as const);

export const parseDeploymentApprovalObservation = (
  observation: unknown,
  expected: {
    readonly extensionId: string;
    readonly extensionVersion: string;
    readonly correlationId: string;
  },
  now: Date,
): DeploymentApprovalObservation | null => {
  const plain = exactPlainObservation(observation, DEPLOYMENT_OBS_FIELDS);
  if (plain === null) return null;
  if (
    !filledString(plain.deploymentIdentity) ||
    !filledString(plain.ownerId) ||
    !filledString(plain.actorId) ||
    !filledString(plain.sessionId) ||
    !filledString(plain.channelId) ||
    !filledString(plain.extensionId) ||
    !filledString(plain.extensionVersion) ||
    !filledString(plain.correlationId) ||
    plain.authorizationScope !== 'activate'
  )
    return null;
  if (
    plain.extensionId !== expected.extensionId ||
    plain.extensionVersion !== expected.extensionVersion ||
    plain.correlationId !== expected.correlationId
  )
    return null;
  const issuedAt = parseIsoInstant(plain.issuedAt);
  const expiresAt = parseIsoInstant(plain.expiresAt);
  if (issuedAt === null || expiresAt === null || !isFreshWindow(issuedAt, expiresAt, now))
    return null;
  return {
    deploymentIdentity: plain.deploymentIdentity,
    ownerId: plain.ownerId,
    actorId: plain.actorId,
    sessionId: plain.sessionId,
    channelId: plain.channelId,
    extensionId: plain.extensionId,
    extensionVersion: plain.extensionVersion,
    authorizationScope: 'activate',
    correlationId: plain.correlationId,
    issuedAt: plain.issuedAt as string,
    expiresAt: plain.expiresAt as string,
  };
};

/**
 * Issues sealed deployment authorization only from a validated deployment observation,
 * sealed current policy, and core-computed manifest digest. Not a public caller-string issuer.
 */
export function issueDeploymentAuthorizationFromObservation(
  deps: Pick<ExtensionActivationDeps, 'clock'>,
  observation: DeploymentApprovalObservation,
  policy: CurrentExtensionPolicySnapshot,
  manifestDigest: string,
): Result<DeploymentAuthorizationEvidence, ExtensionActivationFailure> {
  if (!isCurrentExtensionPolicySnapshot(policy))
    return err({ code: 'POLICY_MISMATCH', reason: 'Sealed current policy is required.' });
  if (
    observation.extensionId !== policy.extensionId ||
    observation.extensionVersion !== policy.extensionVersion
  )
    return err({
      code: 'DEPLOYMENT_UNAUTHORIZED',
      reason: 'Deployment observation does not match policy.',
    });
  if (typeof manifestDigest !== 'string' || manifestDigest.length === 0)
    return err({ code: 'MANIFEST_MISMATCH', reason: 'Manifest digest is required.' });

  const now = deps.clock.now();
  const issued = parseIsoInstant(observation.issuedAt);
  const expires = parseIsoInstant(observation.expiresAt);
  if (issued === null || expires === null || !isFreshWindow(issued, expires, now))
    return err({ code: 'STALE_AUTHORIZATION', reason: 'Deployment observation is stale.' });

  const ttl = policy.deploymentAuthorizationTtlMs;
  const policyExpires = issued + ttl;
  const effectiveExpires = Math.min(expires, policyExpires);
  if (effectiveExpires <= now.getTime())
    return err({ code: 'STALE_AUTHORIZATION', reason: 'Policy-controlled TTL already expired.' });

  return ok(
    sealDeploymentAuthorization({
      deploymentIdentity: observation.deploymentIdentity,
      extensionId: observation.extensionId,
      extensionVersion: observation.extensionVersion,
      manifestDigest,
      policyVersion: policy.policyVersion,
      issuedAt: observation.issuedAt as ISO8601,
      expiresAt: new Date(effectiveExpires).toISOString() as ISO8601,
    }),
  );
}

const sameStringList = (left: readonly string[], right: readonly string[]): boolean => {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1)
    if (left[index] !== right[index]) return false;
  return true;
};

const verifyReturnedEntry = (
  pending: SealedExtensionRegistryEntry,
  returned: SealedExtensionRegistryEntry,
  decision: {
    readonly targetState: ExtensionActivationState;
    readonly policyVersion: string;
    readonly manifestDigest: string;
    readonly effectiveRiskClass: string;
  },
): ExtensionActivationFailure | null => {
  if (!isSealedExtensionRegistryEntry(returned))
    return { code: 'RETURNED_ENTRY_MISMATCH', reason: 'Registry returned an unsealed entry.' };
  if (returned.extensionId !== pending.extensionId)
    return { code: 'RETURNED_ENTRY_MISMATCH', reason: 'Returned extension id mismatch.' };
  if (returned.version !== pending.version)
    return { code: 'RETURNED_ENTRY_MISMATCH', reason: 'Returned version mismatch.' };
  if (returned.activationState !== decision.targetState)
    return { code: 'RETURNED_ENTRY_MISMATCH', reason: 'Returned activation state mismatch.' };
  if (returned.policyVersion !== decision.policyVersion)
    return { code: 'RETURNED_ENTRY_MISMATCH', reason: 'Returned policy version mismatch.' };
  if (returned.effectiveRiskClass !== decision.effectiveRiskClass)
    return { code: 'RETURNED_ENTRY_MISMATCH', reason: 'Returned effective risk mismatch.' };
  if (computeManifestDigest(returned) !== decision.manifestDigest)
    return { code: 'RETURNED_ENTRY_MISMATCH', reason: 'Returned manifest digest mismatch.' };
  if (
    returned.manifest.id !== pending.manifest.id ||
    returned.manifest.version !== pending.manifest.version
  )
    return { code: 'RETURNED_ENTRY_MISMATCH', reason: 'Returned manifest identity mismatch.' };
  if (
    returned.provenance.status !== pending.provenance.status ||
    returned.provenance.source !== pending.provenance.source
  )
    return { code: 'RETURNED_ENTRY_MISMATCH', reason: 'Returned provenance mismatch.' };
  if (!sameStringList(returned.grantedCapabilityRefs, pending.grantedCapabilityRefs))
    return { code: 'RETURNED_ENTRY_MISMATCH', reason: 'Returned capability grants mismatch.' };
  if (!sameStringList(returned.grantedPermissionRefs, pending.grantedPermissionRefs))
    return { code: 'RETURNED_ENTRY_MISMATCH', reason: 'Returned permission grants mismatch.' };
  return null;
};

/**
 * Trusted activation step. Active evidence is produced only after a successful registry transition
 * and full returned-entry verification.
 */
export async function executeExtensionActivation(
  deps: ExtensionActivationDeps,
  command: ExtensionActivationCommand,
  context: OperationContext,
): Promise<Result<ExtensionActivationOutcome, ExtensionActivationFailure>> {
  if (validateOperationContext(context) !== null)
    return err({
      code: 'INVALID_OPERATION_CONTEXT',
      reason: 'Valid operation context is required.',
    });
  if (!isSealedExtensionRegistryEntry(command.pendingEntry))
    return err({ code: 'INVALID_ENTRY', reason: 'Sealed pending registry entry is required.' });
  if (!isDeploymentAuthorizationEvidence(command.deploymentAuthorization))
    return err({
      code: 'DEPLOYMENT_UNAUTHORIZED',
      reason: 'Sealed deployment authorization is required.',
    });

  const pending = command.pendingEntry;
  if (pending.activationState !== 'pending-policy')
    return err({ code: 'NOT_PENDING', reason: 'Only pending-policy entries may be activated.' });

  const now = deps.clock.now();
  const auth = command.deploymentAuthorization;
  if (!isFresh(auth.issuedAt, auth.expiresAt, now))
    return err({ code: 'STALE_AUTHORIZATION', reason: 'Deployment authorization is stale.' });
  if (auth.extensionId !== pending.extensionId || auth.extensionVersion !== pending.version)
    return err({
      code: 'DEPLOYMENT_UNAUTHORIZED',
      reason: 'Deployment authorization does not match the entry.',
    });

  const manifestDigest = computeManifestDigest(pending);
  if (auth.manifestDigest !== manifestDigest)
    return err({
      code: 'MANIFEST_MISMATCH',
      reason: 'Deployment authorization manifest mismatch.',
    });
  if (auth.policyVersion !== command.policyVersion || auth.policyVersion !== pending.policyVersion)
    return err({ code: 'POLICY_MISMATCH', reason: 'Policy version mismatch.' });
  if (!pending.manifest.enabled)
    return err({ code: 'DISABLED', reason: 'Disabled manifest cannot become active.' });
  if (!isAllowedActivationTransition(pending.activationState, command.targetState))
    return err({
      code: 'INVALID_TRANSITION',
      reason: 'Activation transition is not allowed.',
    });

  const decidedAt = now.toISOString() as ISO8601;
  const expiresAt = new Date(now.getTime() + 60_000).toISOString() as ISO8601;
  const decision = sealTrustedActivationDecision({
    extensionId: pending.extensionId,
    version: pending.version,
    targetState: command.targetState,
    expectedPreviousState: 'pending-policy',
    policyVersion: command.policyVersion,
    manifestDigest,
    effectiveRiskClass: pending.effectiveRiskClass,
    deploymentAuthorization: auth,
    decidedAt,
    expiresAt,
    nonce: command.decisionNonce,
  });
  if (decision === null || !isTrustedActivationDecision(decision))
    return err({
      code: 'DEPLOYMENT_UNAUTHORIZED',
      reason: 'Trusted activation decision could not be sealed.',
    });
  if (!isFresh(decision.decidedAt, decision.expiresAt, now))
    return err({ code: 'STALE_DECISION', reason: 'Trusted activation decision is stale.' });

  const updated = await deps.registry.updateActivationState(decision, context);
  if (!updated.ok)
    return err({ code: 'REGISTRY_UNAVAILABLE', reason: 'Activation update failed.' });

  const mismatch = verifyReturnedEntry(pending, updated.value, {
    targetState: command.targetState,
    policyVersion: command.policyVersion,
    manifestDigest,
    effectiveRiskClass: pending.effectiveRiskClass,
  });
  if (mismatch !== null) return err(mismatch);

  const activeRegistration =
    command.targetState === 'active'
      ? sealActiveExtensionRegistration(updated.value, manifestDigest)
      : null;
  if (command.targetState === 'active' && activeRegistration === null)
    return err({ code: 'INVALID_TRANSITION', reason: 'Active evidence could not be sealed.' });

  return ok({ entry: updated.value, activeRegistration });
}
