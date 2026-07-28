import type {
  AuthenticatedMemoryAccessContext,
  DomainError,
  Result,
  SafeMemoryAuditEvent,
} from '../domain/index.js';
/** Accepts classification and identifiers only; raw content and metadata values are excluded by type. */
export interface MemoryAuditPort {
  record(
    event: SafeMemoryAuditEvent,
    access: AuthenticatedMemoryAccessContext,
  ): Promise<Result<void, DomainError>>;
}
