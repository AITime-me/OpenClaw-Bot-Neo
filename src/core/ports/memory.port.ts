import type {
  AuthenticatedMemoryAccessContext,
  DomainError,
  MemoryDeleteRequest,
  MemoryQueryRequest,
  MemoryReadRequest,
  MemoryRecord,
  MemoryRecordId,
  Result,
  VerifiedMemoryWrite,
} from '../domain/index.js';
/**
 * Every operation requires opaque authenticated access evidence. `write` accepts only a write
 * contract sealed by the memory-write application service, so raw content cannot reach the
 * sink, and `delete` requires the expected owner and namespace instead of a bare identifier.
 * Ordinary MemoryAccessContext object literals are not authorization.
 */
export interface MemoryPort {
  query(
    request: MemoryQueryRequest,
    access: AuthenticatedMemoryAccessContext,
  ): Promise<Result<readonly MemoryRecord[], DomainError>>;
  read(
    request: MemoryReadRequest,
    access: AuthenticatedMemoryAccessContext,
  ): Promise<Result<MemoryRecord, DomainError>>;
  write(
    write: VerifiedMemoryWrite,
    access: AuthenticatedMemoryAccessContext,
  ): Promise<Result<MemoryRecordId, DomainError>>;
  delete(
    request: MemoryDeleteRequest,
    access: AuthenticatedMemoryAccessContext,
  ): Promise<Result<void, DomainError>>;
}
