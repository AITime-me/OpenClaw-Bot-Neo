import {
  err,
  ok,
  validateOperationContext,
  type ExtensionManifestFailure,
  type ISO8601,
  type OperationContext,
  type Result,
  type SealedExtensionRegistryEntry,
} from '../domain/index.js';
import { sealExtensionRegistryEntry } from '../domain/extension-registry-entry.internal.js';
import type { ClockPort, ExtensionRegistryPort } from '../ports/index.js';
import { validateExtensionManifest } from '../policy/extension-manifest.js';

export interface ExtensionRegistrationDeps {
  readonly registry: ExtensionRegistryPort;
  readonly clock: ClockPort;
}

export type ExtensionRegistrationFailure =
  | ExtensionManifestFailure
  | {
      readonly code: 'INVALID_OPERATION_CONTEXT' | 'REGISTRY_UNAVAILABLE' | 'DUPLICATE_ID_VERSION';
      readonly reason: string;
    };

export interface ExtensionRegistrationOutcome {
  readonly entry: SealedExtensionRegistryEntry;
  /**
   * Registration never activates an extension. Enabled manifests become pending-policy;
   * disabled manifests become disabled. Active requires a separate trusted activation step.
   */
  readonly activation: 'disabled' | 'pending-policy';
}

const POLICY_VERSION = 'extension-policy@1';

export async function executeExtensionRegistration(
  deps: ExtensionRegistrationDeps,
  candidate: unknown,
  context: OperationContext,
): Promise<Result<ExtensionRegistrationOutcome, ExtensionRegistrationFailure>> {
  if (validateOperationContext(context) !== null)
    return err({
      code: 'INVALID_OPERATION_CONTEXT',
      reason: 'Valid operation context is required.',
    });
  const validation = validateExtensionManifest(candidate);
  if (!validation.ok) return validation;
  const conflict = await deps.registry.hasConflict(
    validation.value.id,
    validation.value.version,
    context,
  );
  if (!conflict.ok)
    return err({ code: 'REGISTRY_UNAVAILABLE', reason: 'Extension registry is unavailable.' });
  if (conflict.value)
    return err({
      code: 'DUPLICATE_ID_VERSION',
      reason: 'Extension ID and version are already registered.',
    });

  const activation = validation.value.enabled ? 'pending-policy' : 'disabled';
  const registeredAt = deps.clock.now().toISOString() as ISO8601;
  const entry = sealExtensionRegistryEntry({
    extensionId: validation.value.id,
    version: validation.value.version,
    manifest: validation.value,
    activationState: activation,
    registeredAt,
    provenance: validation.value.provenance,
    policyVersion: POLICY_VERSION,
    effectiveRiskClass: validation.value.riskClass,
    grantedCapabilityRefs: [],
    grantedPermissionRefs: [],
    disabledReason: activation === 'disabled' ? 'manifest-disabled' : null,
    pendingReason: activation === 'pending-policy' ? 'awaiting-trusted-policy-activation' : null,
  });

  const registered = await deps.registry.register(entry, context);
  if (!registered.ok)
    return err({ code: 'REGISTRY_UNAVAILABLE', reason: 'Extension registration failed.' });
  return ok({ entry, activation });
}
