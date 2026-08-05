import type { Result } from '../../core/domain/result.js';
import type { CorrelationId, IdentityFailure } from '../../core/domain/identity.js';
import { parseCorrelationId } from '../../core/domain/identity.js';
import {
  parseTurnId,
  type TurnId,
} from '../../core/communication/domain/communication-identity.js';
import type { CommunicationIdGeneratorPort } from '../../core/communication/ports/communication-id-generator.port.js';

let seq = 0;

export const createReferenceIdGenerator = (): CommunicationIdGeneratorPort => ({
  generateTurnId(): Result<TurnId, IdentityFailure> {
    seq += 1;
    return parseTurnId(`turn-ref-${String(seq)}`);
  },
  generateCorrelationId(): Result<CorrelationId, IdentityFailure> {
    seq += 1;
    return parseCorrelationId(`corr-ref-${String(seq)}`);
  },
});
