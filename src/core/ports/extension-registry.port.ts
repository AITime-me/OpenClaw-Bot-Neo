import type {
  DomainError,
  ExtensionPermission,
  Result,
  VerifiedExtensionManifest,
} from '../domain/index.js';
import type { OperationContext } from './operation-context.js';

/**
 * Provider-independent registry contract. Implementations live outside core and may only be called
 * by a trusted deployment/application registration flow after manifest validation.
 */
export interface ExtensionRegistryPort {
  /** Implementation must reject an ID/version conflict atomically even after a prior check. */
  register(
    manifest: VerifiedExtensionManifest,
    context: OperationContext,
  ): Promise<Result<void, DomainError>>;
  get(
    id: string,
    version: string,
    context: OperationContext,
  ): Promise<Result<VerifiedExtensionManifest, DomainError>>;
  listEnabled(
    context: OperationContext,
  ): Promise<Result<readonly VerifiedExtensionManifest[], DomainError>>;
  hasConflict(
    id: string,
    version: string,
    context: OperationContext,
  ): Promise<Result<boolean, DomainError>>;
  getDeclaredCapabilities(
    id: string,
    version: string,
    context: OperationContext,
  ): Promise<Result<readonly string[], DomainError>>;
  getRequestedPermissions(
    id: string,
    version: string,
    context: OperationContext,
  ): Promise<Result<readonly ExtensionPermission[], DomainError>>;
}
