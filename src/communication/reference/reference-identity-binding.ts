import { ok } from '../../core/domain/result.js';
import type { OperationContext } from '../../core/domain/operation-context.js';
import type {
  CommunicationIdentityBindingPort,
  CommunicationIdentityBindingResolution,
} from '../../core/communication/ports/communication-identity-binding.port.js';
import { parseActorId, parseOwnerId } from '../../core/domain/identity.js';
import { parseConversationId } from '../../core/communication/domain/communication-identity.js';

/** Deterministic offline identity binding for reference composition. */
export const createReferenceIdentityBinding = (fixed?: {
  readonly ownerId?: string;
  readonly actorId?: string;
  readonly conversationId?: string;
}): CommunicationIdentityBindingPort => ({
  resolveBinding(request, _operationContext: OperationContext) {
    void _operationContext;
    const ownerId = parseOwnerId(fixed?.ownerId ?? 'owner-1');
    const actorId = parseActorId(fixed?.actorId ?? 'actor-1');
    const conversationId = parseConversationId(
      fixed?.conversationId ??
        `conversation-${String(request.observation.externalConversationReference)}`,
    );
    if (!ownerId.ok || !actorId.ok || !conversationId.ok)
      return Promise.resolve(
        ok({
          kind: 'rejected',
          reason: 'Reference binding identity parse failed.',
        } satisfies CommunicationIdentityBindingResolution),
      );

    return Promise.resolve(
      ok({
        kind: 'bound',
        binding: Object.freeze({
          ownerId: ownerId.value,
          actorId: actorId.value,
          conversationId: conversationId.value,
          transportInstanceId: request.transportInstanceId,
          bindingVersion: request.bindingVersion,
        }),
      }),
    );
  },
});
