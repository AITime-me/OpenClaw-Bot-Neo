import type { CorrelationId, OwnerId } from '../../domain/identity.js';
import { deepFreeze } from '../../domain/immutable.js';
import { err, ok, type Result } from '../../domain/result.js';
import {
  getAuthenticatedCommunicationPrincipalCanonical,
  isAuthenticatedCommunicationPrincipal,
} from '../domain/authenticated-communication-principal.internal.js';
import type { AuthenticatedCommunicationPrincipal, ConversationId } from '../domain/index.js';
import {
  COMMUNICATION_MEMORY_READ_PURPOSE,
  type CommunicationMemoryAuthorizationFailure,
  type CommunicationMemoryContextBuilderInput,
} from '../ports/communication-memory-authorization.port.js';

export const MIN_COMMUNICATION_MEMORY_MAX_RECORDS = 1 as const;
export const MAX_COMMUNICATION_MEMORY_MAX_RECORDS = 16 as const;
export const MIN_COMMUNICATION_MEMORY_MAX_TOTAL_BYTES = 1 as const;
export const MAX_COMMUNICATION_MEMORY_MAX_TOTAL_BYTES = 16_384 as const;

export interface CommunicationMemoryAuthorizationPolicyInput {
  readonly principal: AuthenticatedCommunicationPrincipal;
  readonly expectedOwnerId: OwnerId;
  readonly expectedConversationId: ConversationId;
  readonly correlationId: CorrelationId;
  readonly purpose: string;
  readonly maxRecords: number;
  readonly maxTotalBytes: number;
  readonly requestedNamespace?: string;
}

export type CommunicationMemoryAuthorizationPolicyDecision = CommunicationMemoryContextBuilderInput;

const deny = (
  code: CommunicationMemoryAuthorizationFailure['code'],
  reason: string,
): Result<
  CommunicationMemoryAuthorizationPolicyDecision,
  CommunicationMemoryAuthorizationFailure
> => err({ code, reason });

const isSafeIntegerInRange = (value: number, min: number, max: number): boolean =>
  Number.isSafeInteger(value) && value >= min && value <= max;

/**
 * Pure communication memory read authorization.
 * Order: verify principal → inspect claims → owner → conversation → purpose → namespace bounds.
 */
export const authorizeCommunicationMemoryRead = (
  input: CommunicationMemoryAuthorizationPolicyInput,
): Result<
  CommunicationMemoryAuthorizationPolicyDecision,
  CommunicationMemoryAuthorizationFailure
> => {
  if (!isAuthenticatedCommunicationPrincipal(input.principal))
    return deny('FORGED_PRINCIPAL', 'Communication principal is not genuine.');

  const claims = getAuthenticatedCommunicationPrincipalCanonical(input.principal);
  if (claims === null)
    return deny('FORGED_PRINCIPAL', 'Communication principal canonical claims are unavailable.');

  if (claims.ownerId !== input.expectedOwnerId)
    return deny('OWNER_MISMATCH', 'Expected owner does not match principal claims.');

  if (claims.conversationId !== input.expectedConversationId)
    return deny('CONVERSATION_MISMATCH', 'Expected conversation does not match principal claims.');

  if (input.purpose !== COMMUNICATION_MEMORY_READ_PURPOSE)
    return deny('INVALID_PURPOSE', 'Memory read purpose is not authorized for communication.');

  if (
    !isSafeIntegerInRange(
      input.maxRecords,
      MIN_COMMUNICATION_MEMORY_MAX_RECORDS,
      MAX_COMMUNICATION_MEMORY_MAX_RECORDS,
    )
  )
    return deny('INVALID_BOUNDS', 'maxRecords is outside the allowed range.');

  if (
    !isSafeIntegerInRange(
      input.maxTotalBytes,
      MIN_COMMUNICATION_MEMORY_MAX_TOTAL_BYTES,
      MAX_COMMUNICATION_MEMORY_MAX_TOTAL_BYTES,
    )
  )
    return deny('INVALID_BOUNDS', 'maxTotalBytes is outside the allowed range.');

  if (input.requestedNamespace !== undefined && input.requestedNamespace !== 'personal')
    return deny(
      'NAMESPACE_DENIED',
      'Only the personal namespace is authorized for communication reads.',
    );

  return ok(
    deepFreeze({
      ownerId: claims.ownerId,
      conversationId: claims.conversationId,
      correlationId: input.correlationId,
      purpose: COMMUNICATION_MEMORY_READ_PURPOSE,
      maxRecords: input.maxRecords,
      maxTotalBytes: input.maxTotalBytes,
    }),
  );
};
