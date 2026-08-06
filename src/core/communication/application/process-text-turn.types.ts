import type { OperationContext } from '../../domain/operation-context.js';
import type { CorrelationId, OwnerId, PolicyVersion } from '../../domain/identity.js';
import type { Result } from '../../domain/result.js';
import type { CommunicationError } from '../domain/communication-errors.js';
import type { AuthenticatedCommunicationPrincipal } from '../domain/authenticated-communication-principal.js';
import type { ConversationId, TurnId, TurnRevision } from '../domain/communication-identity.js';
import type { TransportTextObservation } from '../domain/transport-text-observation.js';
import type { CommunicationTurnLedgerPort } from '../ports/communication-turn-ledger.port.js';
import type { CommunicationAuditPort } from '../ports/communication-audit.port.js';
import type { CommunicationDeliveryOutboxPort } from '../ports/communication-delivery-outbox.port.js';
import type { ConversationStatePort } from '../ports/conversation-state.port.js';
import type { LlmCompletionPort } from '../ports/llm-completion.port.js';
import type { TextDeliveryPort } from '../ports/text-delivery.port.js';
import type { CommunicationMemoryAuthorizationPort } from '../ports/communication-memory-authorization.port.js';
import type { SensitiveDataScannerPort } from '../../ports/sensitive-data-scanner.port.js';
import type { CommunicationKillSwitchPort } from '../ports/communication-kill-switch.port.js';
import { communicationError } from '../domain/communication-errors.js';
import type { TransitionFn } from './phases/unknown-terminalization.js';

export type ProcessTextTurnInput = {
  readonly turnId: TurnId;
  readonly correlationId: CorrelationId;
  readonly principal: AuthenticatedCommunicationPrincipal;
  readonly ownerId: OwnerId;
  readonly conversationId: ConversationId;
  readonly observation: TransportTextObservation;
  readonly turnRevision: TurnRevision;
  readonly policyVersion: PolicyVersion;
  readonly abortSignal: AbortSignal | null;
  readonly deadlineMs: number;
  readonly generation: number;
};

export type ProcessTextTurnDeps = {
  readonly ledger: CommunicationTurnLedgerPort;
  readonly audit: CommunicationAuditPort;
  readonly outbox: CommunicationDeliveryOutboxPort;
  readonly conversationState: ConversationStatePort;
  readonly llm: LlmCompletionPort;
  readonly delivery: TextDeliveryPort;
  readonly memory: CommunicationMemoryAuthorizationPort;
  readonly scanner: SensitiveDataScannerPort;
  readonly killSwitch: CommunicationKillSwitchPort;
  readonly isGenerationCurrent: (generation: number) => boolean;
  readonly noteLlmCall?: () => void;
  readonly noteDeliveryCall?: () => void;
  readonly noteMemoryCall?: () => void;
};

export type ProcessTextTurnSuccess =
  { readonly kind: 'completed' } | { readonly kind: 'completed-blocked-by-gate' };

export const bindTransition = (
  deps: ProcessTextTurnDeps,
  input: ProcessTextTurnInput,
  operationContext: OperationContext,
): TransitionFn => {
  return async (expectedRevision, expectedState, targetState) => {
    const result = await deps.ledger.transition(
      {
        turnId: input.turnId,
        expectedRevision: expectedRevision as never,
        expectedState,
        targetState,
        correlationId: input.correlationId,
      },
      operationContext,
    );
    if (!result.ok) return result;
    if (result.value.kind === 'transitioned')
      return { ok: true, value: Number(result.value.turnRevision) };
    if (result.value.kind === 'already-transitioned') return { ok: true, value: expectedRevision };
    return {
      ok: false,
      error: communicationError('LEDGER_UNAVAILABLE', result.value.kind),
    };
  };
};

export type ProcessTextTurnResult = Result<ProcessTextTurnSuccess, CommunicationError>;
