import type { SafeToolAuditEvent } from '../domain/connector/policy.js';
import type { ToolInvocationContext } from '../domain/connector/invocation.js';
import type { Result } from '../domain/result.js';
import type { DomainError } from '../domain/errors.js';

export interface ToolAuditPort {
  record(
    event: SafeToolAuditEvent,
    context: ToolInvocationContext,
  ): Promise<Result<void, DomainError>>;
}
