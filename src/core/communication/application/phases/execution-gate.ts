import type { OperationContext } from '../../../domain/operation-context.js';
import type { OwnerId } from '../../../domain/identity.js';
import { ok, type Result } from '../../../domain/result.js';
import { communicationError, type CommunicationError } from '../../domain/communication-errors.js';
import type { ConversationId } from '../../domain/communication-identity.js';
import type { ConversationStatePort } from '../../ports/conversation-state.port.js';

export type ExecutionGateOutcome =
  { readonly kind: 'eligible' } | { readonly kind: 'blocked'; readonly reason: string };

/**
 * Fail-closed gate before memory/prompt/LLM.
 * Blocks when pause is degraded or checkpoint is pending/failed (active barrier).
 */
export const evaluateConversationExecutionGate = async (
  conversationState: ConversationStatePort,
  key: { readonly ownerId: OwnerId; readonly conversationId: ConversationId },
  operationContext: OperationContext,
): Promise<Result<ExecutionGateOutcome, CommunicationError>> => {
  const loaded = await conversationState.load(key, operationContext);
  if (!loaded.ok) return loaded;
  if (loaded.value.kind === 'unavailable')
    return {
      ok: false,
      error: communicationError('CONVERSATION_STATE_UNAVAILABLE', loaded.value.reason),
    };
  if (loaded.value.kind === 'not-found') return ok({ kind: 'eligible' });

  const snapshot = loaded.value.snapshot;
  if (snapshot.pauseState === 'degraded')
    return ok({
      kind: 'blocked',
      reason: 'Conversation pauseState is degraded; automatic unpause is forbidden.',
    });
  if (snapshot.checkpoint.status === 'pending' || snapshot.checkpoint.status === 'failed')
    return ok({
      kind: 'blocked',
      reason: `Conversation checkpointStatus=${snapshot.checkpoint.status}; barrier/gate active.`,
    });
  return ok({ kind: 'eligible' });
};
