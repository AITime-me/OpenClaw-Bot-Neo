import { ok, err } from '../../core/domain/result.js';
import type { OperationContext } from '../../core/domain/operation-context.js';
import type { CommunicationMemoryAuthorizationPort } from '../../core/communication/ports/communication-memory-authorization.port.js';
import { COMMUNICATION_MEMORY_READ_PURPOSE } from '../../core/communication/ports/communication-memory-authorization.port.js';
import { isAuthenticatedCommunicationPrincipal } from '../../core/communication/domain/authenticated-communication-principal.internal.js';
import { deepFreeze } from '../../core/domain/immutable.js';

/** Read-only empty memory broker — never returns MemoryPort or write capability. */
export const createReferenceMemoryAuthorization = (): CommunicationMemoryAuthorizationPort => ({
  readAuthorizedContext(request, _operationContext: OperationContext) {
    void _operationContext;
    if (!isAuthenticatedCommunicationPrincipal(request.principal))
      return Promise.resolve(
        err({ code: 'FORGED_PRINCIPAL', reason: 'Principal is not genuine.' }),
      );
    return Promise.resolve(
      ok(
        deepFreeze({
          ownerId: request.expectedOwnerId,
          conversationId: request.expectedConversationId,
          correlationId: request.correlationId,
          purpose: COMMUNICATION_MEMORY_READ_PURPOSE,
          excerpts: Object.freeze([]),
          totalUtf8Bytes: 0,
        }),
      ),
    );
  },
});
