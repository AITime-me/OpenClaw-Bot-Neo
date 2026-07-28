import type {
  DomainError,
  ExtensionActivationState,
  ExtensionPermission,
  Result,
  SealedExtensionRegistryEntry,
  TrustedActivationDecision,
} from '../domain/index.js';
import type { OperationContext } from './operation-context.js';

/**
 * Provider-independent registry contract. Implementations live outside core and never load code,
 * packages, marketplace artifacts or executable paths.
 */
export interface ExtensionRegistryPort {
  /** Persist a sealed registry entry. Must reject ID/version conflicts atomically. */
  register(
    entry: SealedExtensionRegistryEntry,
    context: OperationContext,
  ): Promise<Result<void, DomainError>>;
  getByIdVersion(
    id: string,
    version: string,
    context: OperationContext,
  ): Promise<Result<SealedExtensionRegistryEntry, DomainError>>;
  listActive(
    context: OperationContext,
  ): Promise<Result<readonly SealedExtensionRegistryEntry[], DomainError>>;
  listPending(
    context: OperationContext,
  ): Promise<Result<readonly SealedExtensionRegistryEntry[], DomainError>>;
  getActivationState(
    id: string,
    version: string,
    context: OperationContext,
  ): Promise<Result<ExtensionActivationState, DomainError>>;
  /**
   * Apply a sealed trusted activation transition atomically.
   * Implementations must require expectedPreviousState, refuse stale/replayed nonces,
   * and return a sealed entry only after a successful exclusive transition.
   */
  updateActivationState(
    decision: TrustedActivationDecision,
    context: OperationContext,
  ): Promise<Result<SealedExtensionRegistryEntry, DomainError>>;
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
