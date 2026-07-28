import {
  err,
  isAllowedActivationTransition,
  ok,
  validateOperationContext,
  type ExtensionActivationState,
  type ExtensionRegistryFailure,
  type OperationContext,
  type Result,
  type SealedExtensionRegistryEntry,
} from '../domain/index.js';
import {
  sealActiveExtensionRegistration,
  sealTrustedActivationDecision,
  type ActiveExtensionRegistration,
  type TrustedActivationDecision,
} from '../domain/extension-registry-entry.internal.js';
import type { ClockPort, ExtensionRegistryPort } from '../ports/index.js';

export interface ExtensionActivationDeps {
  readonly registry: ExtensionRegistryPort;
  readonly clock: ClockPort;
}

export type ExtensionActivationFailure =
  | ExtensionRegistryFailure
  | {
      readonly code: 'INVALID_OPERATION_CONTEXT' | 'DEPLOYMENT_UNAUTHORIZED' | 'RISK_DENIED';
      readonly reason: string;
    };

export interface ExtensionActivationCommand {
  readonly extensionId: string;
  readonly version: string;
  readonly targetState: ExtensionActivationState;
  readonly policyVersion: string;
  /** Must be true from a trusted deployment boundary — ordinary callers cannot forge this. */
  readonly deploymentAuthorized: boolean;
}

/**
 * Trusted activation step. Callers supply a command; the service seals the decision and asks the
 * registry to apply only allowed transitions. Ordinary booleans outside this flow are not evidence.
 */
export async function executeExtensionActivation(
  deps: ExtensionActivationDeps,
  command: ExtensionActivationCommand,
  context: OperationContext,
): Promise<Result<SealedExtensionRegistryEntry, ExtensionActivationFailure>> {
  if (validateOperationContext(context) !== null)
    return err({
      code: 'INVALID_OPERATION_CONTEXT',
      reason: 'Valid operation context is required.',
    });
  if (!command.deploymentAuthorized)
    return err({
      code: 'DEPLOYMENT_UNAUTHORIZED',
      reason: 'Trusted deployment authorization is required.',
    });

  const current = await deps.registry.getByIdVersion(command.extensionId, command.version, context);
  if (!current.ok)
    return err({ code: 'REGISTRY_UNAVAILABLE', reason: 'Extension registry is unavailable.' });
  if (!isAllowedActivationTransition(current.value.activationState, command.targetState))
    return err({
      code: 'INVALID_TRANSITION',
      reason: 'Activation transition is not allowed.',
    });
  if (command.targetState === 'active' && !current.value.manifest.enabled)
    return err({
      code: 'DISABLED',
      reason: 'Disabled manifest cannot become active.',
    });
  if (
    command.targetState === 'active' &&
    (current.value.effectiveRiskClass === 'untrusted-input' ||
      current.value.manifest.riskClass === 'untrusted-input') &&
    command.policyVersion.length === 0
  )
    return err({ code: 'RISK_DENIED', reason: 'Untrusted risk cannot activate without policy.' });

  const decision: TrustedActivationDecision = sealTrustedActivationDecision({
    extensionId: command.extensionId,
    version: command.version,
    targetState: command.targetState,
    policyVersion: command.policyVersion,
    decidedAt: deps.clock.now().toISOString(),
  });
  const updated = await deps.registry.updateActivationState(decision, context);
  if (!updated.ok)
    return err({ code: 'REGISTRY_UNAVAILABLE', reason: 'Activation update failed.' });
  return ok(updated.value);
}

/** Derive sealed active evidence for permission resolution from a registry entry. */
export function toActiveExtensionRegistration(
  entry: SealedExtensionRegistryEntry,
): ActiveExtensionRegistration | null {
  return sealActiveExtensionRegistration(entry);
}
