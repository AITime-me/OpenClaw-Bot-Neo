import {
  err,
  ok,
  validateOperationContext,
  type ExtensionManifestFailure,
  type OperationContext,
  type Result,
  type VerifiedExtensionManifest,
} from '../domain/index.js';
import type { ExtensionRegistryPort } from '../ports/index.js';
import { validateExtensionManifest } from '../policy/extension-manifest.js';

export interface ExtensionRegistrationDeps {
  readonly registry: ExtensionRegistryPort;
}

export type ExtensionRegistrationFailure =
  | ExtensionManifestFailure
  | {
      readonly code: 'INVALID_OPERATION_CONTEXT' | 'REGISTRY_UNAVAILABLE' | 'DUPLICATE_ID_VERSION';
      readonly reason: string;
    };

export interface ExtensionRegistrationOutcome {
  readonly manifest: VerifiedExtensionManifest;
  /** Registration never activates an extension; permission resolution remains a separate gate. */
  readonly activation: 'disabled' | 'pending-policy';
}

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
  const registered = await deps.registry.register(validation.value, context);
  if (!registered.ok)
    return err({ code: 'REGISTRY_UNAVAILABLE', reason: 'Extension registration failed.' });
  return ok({
    manifest: validation.value,
    activation: validation.value.enabled ? 'pending-policy' : 'disabled',
  });
}
