import { ok } from '../../core/domain/result.js';
import type { OperationContext } from '../../core/domain/operation-context.js';
import type { TextDeliveryPort } from '../../core/communication/ports/text-delivery.port.js';
import type { TextDeliveryOutcome } from '../../core/communication/ports/text-delivery.port.js';

export type ReferenceDeliveryScenario =
  | 'delivered'
  | 'known-failure'
  | 'outcome-unknown'
  | 'disabled'
  | 'recipient-denied'
  | 'wait-for-abort';

export const createReferenceTextDelivery = (
  scenario: ReferenceDeliveryScenario = 'delivered',
): TextDeliveryPort & { setScenario: (next: ReferenceDeliveryScenario) => void } => {
  let current = scenario;
  return {
    setScenario(next) {
      current = next;
    },
    async deliver(_request, _operationContext: OperationContext) {
      void _request;
      void _operationContext;
      if (current === 'wait-for-abort') {
        const signal = _request.abortSignal ?? null;
        if (signal === null || signal.aborted)
          return ok({
            kind: 'outcome-unknown',
            reason: 'Delivery aborted without durable proof.',
          } satisfies TextDeliveryOutcome);
        await new Promise<void>((resolve) => {
          const onAbort = (): void => {
            signal.removeEventListener('abort', onAbort);
            resolve();
          };
          signal.addEventListener('abort', onAbort);
        });
        return ok({
          kind: 'outcome-unknown',
          reason: 'Delivery aborted without durable proof.',
        });
      }
      if (current === 'delivered') return ok({ kind: 'delivered' });
      if (current === 'known-failure')
        return ok({ kind: 'known-failure', reason: 'Reference known delivery failure.' });
      if (current === 'disabled')
        return ok({ kind: 'disabled', reason: 'Reference delivery disabled.' });
      if (current === 'recipient-denied')
        return ok({ kind: 'recipient-denied', reason: 'Reference recipient denied.' });
      return ok({ kind: 'outcome-unknown', reason: 'Reference delivery outcome unknown.' });
    },
  };
};
