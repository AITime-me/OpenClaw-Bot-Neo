import { ok } from '../../core/domain/result.js';
import type { OperationContext } from '../../core/domain/operation-context.js';
import type { LlmCompletionPort } from '../../core/communication/ports/llm-completion.port.js';
import type { LlmCompletionResult } from '../../core/communication/domain/llm-completion.js';

export type ReferenceLlmScenario =
  | 'completed'
  | 'provider-unavailable'
  | 'quota-unavailable'
  | 'known-timeout'
  | 'policy-rejected'
  | 'invalid-response'
  | 'outcome-unknown'
  | 'wait-for-abort';

export const createReferenceLlmCompletion = (
  scenario: ReferenceLlmScenario = 'completed',
): LlmCompletionPort & { setScenario: (next: ReferenceLlmScenario) => void } => {
  let current = scenario;
  return {
    setScenario(next) {
      current = next;
    },
    async complete(request, _operationContext: OperationContext) {
      void _operationContext;
      if (current === 'wait-for-abort') {
        const signal = request.abortSignal;
        if (signal === null || signal.aborted)
          return ok({
            kind: 'outcome-unknown',
            outcome: 'outcome-unknown',
          } satisfies LlmCompletionResult);
        await new Promise<void>((resolve) => {
          const onAbort = (): void => {
            signal.removeEventListener('abort', onAbort);
            resolve();
          };
          signal.addEventListener('abort', onAbort);
        });
        return ok({ kind: 'outcome-unknown', outcome: 'outcome-unknown' });
      }
      if (current === 'completed')
        return ok({
          kind: 'completed',
          outcome: 'completed',
          text: 'reference-llm-safe-reply',
        });
      if (current === 'outcome-unknown')
        return ok({ kind: 'outcome-unknown', outcome: 'outcome-unknown' });
      return ok({
        kind: 'known-failure',
        outcome: current,
      });
    },
  };
};
