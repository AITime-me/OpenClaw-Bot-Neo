import type {
  DomainError,
  MemoryAccessContext,
  MemoryDeleteRequest,
  MemoryQueryRequest,
  MemoryReadRequest,
  MemoryRecord,
  MemoryRecordId,
  Result,
  VerifiedMemoryWrite,
} from '../domain/index.js';
/**
 * Every operation requires an authenticated access context. `write` accepts only a write
 * contract sealed by the memory-write application service, so raw content cannot reach the
 * sink, and `delete` requires the expected owner and namespace instead of a bare identifier.
 */
export interface MemoryPort {
  query(
    request: MemoryQueryRequest,
    access: MemoryAccessContext,
  ): Promise<Result<readonly MemoryRecord[], DomainError>>;
  read(
    request: MemoryReadRequest,
    access: MemoryAccessContext,
  ): Promise<Result<MemoryRecord, DomainError>>;
  write(
    write: VerifiedMemoryWrite,
    access: MemoryAccessContext,
  ): Promise<Result<MemoryRecordId, DomainError>>;
  delete(
    request: MemoryDeleteRequest,
    access: MemoryAccessContext,
  ): Promise<Result<void, DomainError>>;
}
