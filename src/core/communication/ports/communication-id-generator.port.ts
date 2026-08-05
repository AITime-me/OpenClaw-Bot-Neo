import type { CorrelationId } from '../../domain/identity.js';
import type { IdentityFailure } from '../../domain/identity.js';
import type { Result } from '../../domain/result.js';
import type { TurnId } from '../domain/communication-identity.js';

/** Trusted local ID generation. Transport must never supply TurnId or CorrelationId. */
export interface CommunicationIdGeneratorPort {
  generateTurnId(): Result<TurnId, IdentityFailure>;
  generateCorrelationId(): Result<CorrelationId, IdentityFailure>;
}
