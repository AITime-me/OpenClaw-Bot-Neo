import type { CorrelationId, OwnerId } from '../../domain/identity.js';
import type { OperationContext } from '../../domain/operation-context.js';
import type { Result } from '../../domain/result.js';
import type { AuthenticatedCommunicationPrincipal, ConversationId } from '../domain/index.js';

export const COMMUNICATION_MEMORY_READ_PURPOSE = 'text-prompt-context' as const;
export type CommunicationMemoryReadPurpose = typeof COMMUNICATION_MEMORY_READ_PURPOSE;

export interface CommunicationMemoryExcerpt {
  readonly recordId: string;
  readonly namespace: 'personal';
  readonly text: string;
  readonly provenanceLabel: string;
  readonly trustLabel: string;
}

/**
 * Bounded read-only memory excerpts for prompt assembly.
 * Deeply frozen, no capability, no write/delete, no arbitrary namespace selector.
 */
export interface CommunicationMemoryContext {
  readonly ownerId: OwnerId;
  readonly conversationId: ConversationId;
  readonly correlationId: CorrelationId;
  readonly purpose: CommunicationMemoryReadPurpose;
  readonly excerpts: readonly CommunicationMemoryExcerpt[];
  readonly totalUtf8Bytes: number;
}

export interface CommunicationMemoryContextBuilderInput {
  readonly ownerId: OwnerId;
  readonly conversationId: ConversationId;
  readonly correlationId: CorrelationId;
  readonly purpose: CommunicationMemoryReadPurpose;
  readonly maxRecords: number;
  readonly maxTotalBytes: number;
}

export interface CommunicationMemoryAuthorizationRequest {
  readonly principal: AuthenticatedCommunicationPrincipal;
  readonly expectedOwnerId: OwnerId;
  readonly expectedConversationId: ConversationId;
  readonly correlationId: CorrelationId;
  readonly purpose: CommunicationMemoryReadPurpose;
  readonly maxRecords: number;
  readonly maxTotalBytes: number;
}

export type CommunicationMemoryAuthorizationFailureCode =
  | 'FORGED_PRINCIPAL'
  | 'OWNER_MISMATCH'
  | 'CONVERSATION_MISMATCH'
  | 'INVALID_PURPOSE'
  | 'NAMESPACE_DENIED'
  | 'CROSS_OWNER_DENIED'
  | 'CROSS_CONVERSATION_DENIED'
  | 'INVALID_BOUNDS'
  | 'MEMORY_UNAVAILABLE'
  | 'MEMORY_UNAUTHORIZED';

export interface CommunicationMemoryAuthorizationFailure {
  readonly code: CommunicationMemoryAuthorizationFailureCode;
  readonly reason: string;
}

/**
 * Broker port: returns bounded CommunicationMemoryContext only.
 * Must never return AuthenticatedMemoryAccessContext, MemoryPort, or write/delete capability.
 */
export interface CommunicationMemoryAuthorizationPort {
  readAuthorizedContext(
    request: CommunicationMemoryAuthorizationRequest,
    operationContext: OperationContext,
  ): Promise<Result<CommunicationMemoryContext, CommunicationMemoryAuthorizationFailure>>;
}
