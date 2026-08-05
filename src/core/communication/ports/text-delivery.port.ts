import type { CorrelationId } from '../../domain/identity.js';
import type { OperationContext } from '../../domain/operation-context.js';
import type { Result } from '../../domain/result.js';
import type {
  AuthenticatedCommunicationPrincipal,
  CommunicationError,
  TurnId,
  ValidatedTextOutput,
} from '../domain/index.js';

export interface TextDeliveryRequest {
  readonly output: ValidatedTextOutput;
  readonly principal: AuthenticatedCommunicationPrincipal;
  readonly turnId: TurnId;
  readonly correlationId: CorrelationId;
}

export type TextDeliveryOutcome =
  | { readonly kind: 'delivered' }
  | { readonly kind: 'known-failure'; readonly reason: string }
  | { readonly kind: 'outcome-unknown'; readonly reason: string }
  | { readonly kind: 'disabled'; readonly reason: string }
  | { readonly kind: 'recipient-denied'; readonly reason: string };

/**
 * Sealed same-binding delivery only.
 * No arbitrary recipient strings, chat ids, or transport SDK types.
 */
export interface TextDeliveryPort {
  deliver(
    request: TextDeliveryRequest,
    operationContext: OperationContext,
  ): Promise<Result<TextDeliveryOutcome, CommunicationError>>;
}
