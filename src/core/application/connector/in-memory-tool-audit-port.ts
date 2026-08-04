import type { ToolAuditPort } from '../../ports/tool-audit.port.js';
import type { SafeToolAuditEvent } from '../../domain/connector/policy.js';
import type { ToolInvocationContext } from '../../domain/connector/invocation.js';
import { ok, type Result } from '../../domain/result.js';
import type { DomainError } from '../../domain/errors.js';

export const createInMemoryToolAuditPort = (
  options: { readonly failAfterExecution?: boolean; readonly failBeforeExecution?: boolean } = {},
): ToolAuditPort & { readonly events: SafeToolAuditEvent[] } => {
  const events: SafeToolAuditEvent[] = [];
  let executionStarted = false;

  return {
    events,
    record(
      event: SafeToolAuditEvent,
      _context: ToolInvocationContext,
    ): Promise<Result<void, DomainError>> {
      void _context;
      if (options.failBeforeExecution && !executionStarted && event.kind === 'execution-started')
        return Promise.resolve({
          ok: false,
          error: { code: 'EXTERNAL_FAILURE', operation: 'audit', retryable: false },
        });
      if (event.kind === 'execution-started') executionStarted = true;
      if (options.failAfterExecution && event.kind === 'invocation-completed')
        return Promise.resolve({
          ok: false,
          error: { code: 'EXTERNAL_FAILURE', operation: 'audit', retryable: false },
        });
      events.push(Object.freeze({ ...event }));
      return Promise.resolve(ok(undefined));
    },
  };
};
