import type {
  DomainError,
  OperationContext,
  Result,
  SafeMediaAuditEvent,
} from '../domain/index.js';
/** Free-form metadata objects are rejected by type; only a safe media audit event is accepted. */
export interface MediaAuditLogPort {
  record(event: SafeMediaAuditEvent, context: OperationContext): Promise<Result<void, DomainError>>;
}
