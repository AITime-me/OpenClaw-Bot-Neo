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
import type { ClockPort, ExtensionRegistryPort } from '../ports/index.js';

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
        | 'INVALID_ENTRY';
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

export const computeManifestDigest = (entry: SealedExtensionRegistryEntry): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        id: entry.manifest.id,
        version: entry.manifest.version,
        riskClass: entry.manifest.riskClass,
        permissions: entry.manifest.requestedPermissions,
        enabled: entry.manifest.enabled,
      }),
      'utf8',
    )
    .digest('hex');

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

/**
 * Trusted activation step. Active evidence is produced only after a successful registry transition.
 * Ordinary booleans and public converters are not authorization proof.
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
  if (!isSealedExtensionRegistryEntry(updated.value))
    return err({ code: 'REGISTRY_UNAVAILABLE', reason: 'Registry returned an unsealed entry.' });
  if (updated.value.activationState !== command.targetState)
    return err({ code: 'INVALID_TRANSITION', reason: 'Registry transition result mismatch.' });

  const activeRegistration =
    command.targetState === 'active'
      ? sealActiveExtensionRegistration(updated.value, manifestDigest)
      : null;
  if (command.targetState === 'active' && activeRegistration === null)
    return err({ code: 'INVALID_TRANSITION', reason: 'Active evidence could not be sealed.' });

  return ok({ entry: updated.value, activeRegistration });
}

export interface DeploymentAuthorizationCommand {
  readonly deploymentIdentity: string;
  readonly extensionId: string;
  readonly extensionVersion: string;
  readonly manifestDigest: string;
  readonly policyVersion: string;
  readonly ttlMs: number;
}

/**
 * Issues sealed deployment authorization inside a trusted deployment boundary.
 * Ordinary booleans are not accepted as proof.
 */
export function issueDeploymentAuthorization(
  deps: Pick<ExtensionActivationDeps, 'clock'>,
  command: DeploymentAuthorizationCommand,
): Result<DeploymentAuthorizationEvidence, ExtensionActivationFailure> {
  if (
    typeof command.deploymentIdentity !== 'string' ||
    command.deploymentIdentity.length === 0 ||
    typeof command.extensionId !== 'string' ||
    command.extensionId.length === 0 ||
    typeof command.extensionVersion !== 'string' ||
    command.extensionVersion.length === 0 ||
    typeof command.manifestDigest !== 'string' ||
    command.manifestDigest.length === 0 ||
    typeof command.policyVersion !== 'string' ||
    command.policyVersion.length === 0 ||
    !Number.isSafeInteger(command.ttlMs) ||
    command.ttlMs <= 0
  )
    return err({
      code: 'DEPLOYMENT_UNAUTHORIZED',
      reason: 'Deployment authorization command is malformed.',
    });
  const issuedAt = deps.clock.now();
  return ok(
    sealDeploymentAuthorization({
      deploymentIdentity: command.deploymentIdentity,
      extensionId: command.extensionId,
      extensionVersion: command.extensionVersion,
      manifestDigest: command.manifestDigest,
      policyVersion: command.policyVersion,
      issuedAt: issuedAt.toISOString() as ISO8601,
      expiresAt: new Date(issuedAt.getTime() + command.ttlMs).toISOString() as ISO8601,
    }),
  );
}
