import { createHash, randomUUID } from 'node:crypto';
import { err, type CorrelationId, type OperationContext, type Result } from '../domain/index.js';
import {
  sealCurrentExtensionPolicySnapshot,
  type CurrentExtensionPolicySnapshot,
} from '../domain/extension-policy.internal.js';
import type {
  ActiveExtensionRegistration,
  SealedExtensionRegistryEntry,
} from '../domain/extension-registry-entry.internal.js';
import { isSealedExtensionRegistryEntry } from '../domain/extension-registry-entry.internal.js';
import type { ClockPort, ExtensionRegistryPort } from '../ports/index.js';
import type {
  AuthenticatedDeploymentApprovalPort,
  CurrentExtensionPolicyPort,
} from '../ports/trusted-derivation.port.js';
import {
  computeManifestDigest,
  executeExtensionActivation,
  issueDeploymentAuthorizationFromObservation,
  parseDeploymentApprovalObservation,
  type ExtensionActivationFailure,
  type ExtensionActivationOutcome,
} from './extension-activation.service.js';

export interface ExtensionActivationGatewayDeps {
  readonly deploymentApproval: AuthenticatedDeploymentApprovalPort;
  readonly policy: CurrentExtensionPolicyPort;
  readonly registry: ExtensionRegistryPort;
  readonly clock: ClockPort;
}

export interface ExtensionActivationGatewayRequest {
  readonly pendingEntry: SealedExtensionRegistryEntry;
  readonly correlationId: CorrelationId;
  readonly requestedAction: 'activate';
  /** Raw deployment/session material — never authorization proof fields. */
  readonly rawAuthorizationMaterial: unknown;
}

export type ExtensionActivationGatewayFailure =
  | ExtensionActivationFailure
  | {
      readonly code:
        'DEPLOYMENT_UNAVAILABLE' | 'POLICY_UNAVAILABLE' | 'INVALID_OBSERVATION' | 'INVALID_ENTRY';
      readonly reason: string;
    };

export interface ExtensionActivationGateway {
  activate(
    request: ExtensionActivationGatewayRequest,
    context: OperationContext,
  ): Promise<Result<ExtensionActivationOutcome, ExtensionActivationGatewayFailure>>;
}

/**
 * Trusted composition boundary for extension activation.
 * Caller supplies pending entry reference and raw authorization material only —
 * never TTL, clock, policy version, deployment identity proof, or sealed authorization.
 */
export function createExtensionActivationGateway(
  deps: ExtensionActivationGatewayDeps,
): ExtensionActivationGateway {
  return {
    async activate(request, context) {
      if (!isSealedExtensionRegistryEntry(request.pendingEntry))
        return err({ code: 'INVALID_ENTRY', reason: 'Sealed pending entry is required.' });
      const pending = request.pendingEntry;
      const now = deps.clock.now();

      const policyResult = await deps.policy.currentPolicy(
        {
          extensionId: pending.extensionId,
          extensionVersion: pending.version,
          correlationId: request.correlationId,
        },
        context,
      );
      if (!policyResult.ok)
        return err({
          code: 'POLICY_UNAVAILABLE',
          reason: 'Current extension policy dependency failed.',
        });
      const policy = sealCurrentExtensionPolicySnapshot(policyResult.value, now, {
        extensionId: pending.extensionId,
        extensionVersion: pending.version,
      });
      if (policy === null)
        return err({
          code: 'INVALID_OBSERVATION',
          reason: 'Current policy observation was rejected.',
        });
      if (policy.policyVersion !== pending.policyVersion)
        return err({
          code: 'POLICY_MISMATCH',
          reason: 'Policy version does not match pending entry.',
        });

      const approvalResult = await deps.deploymentApproval.observe(
        request.rawAuthorizationMaterial,
        {
          extensionId: pending.extensionId,
          extensionVersion: pending.version,
          correlationId: request.correlationId,
          requestedAction: 'activate',
        },
        context,
      );
      if (!approvalResult.ok)
        return err({
          code: 'DEPLOYMENT_UNAVAILABLE',
          reason: 'Deployment approval dependency failed.',
        });
      const observation = parseDeploymentApprovalObservation(
        approvalResult.value,
        {
          extensionId: pending.extensionId,
          extensionVersion: pending.version,
          correlationId: request.correlationId,
        },
        now,
      );
      if (observation === null)
        return err({
          code: 'INVALID_OBSERVATION',
          reason: 'Deployment approval observation was rejected.',
        });

      const manifestDigest = computeManifestDigest(pending);
      const authorization = issueDeploymentAuthorizationFromObservation(
        { clock: deps.clock },
        observation,
        policy,
        manifestDigest,
      );
      if (!authorization.ok) return authorization;

      const nonce = createHash('sha256')
        .update(`${request.correlationId}:${randomUUID()}`, 'utf8')
        .digest('hex')
        .slice(0, 32);

      return executeExtensionActivation(
        { registry: deps.registry, clock: deps.clock },
        {
          pendingEntry: pending,
          deploymentAuthorization: authorization.value,
          targetState: 'active',
          policyVersion: policy.policyVersion,
          decisionNonce: nonce,
        },
        context,
      );
    },
  };
}

export type { ActiveExtensionRegistration, CurrentExtensionPolicySnapshot };
