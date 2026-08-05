import { exactPlainObservation } from '../../domain/observation-validation.js';
import { deepFreeze } from '../../domain/immutable.js';
import { err, ok, type Result } from '../../domain/result.js';
import {
  MAX_TRANSPORT_OBSERVATION_TEXT_UTF8_BYTES,
  normalizeAndValidateCommunicationText,
  parseExternalTransportConversationReference,
  parseExternalTransportInstanceReference,
  parseExternalTransportMessageReference,
  parseExternalTransportSenderReference,
  parseUntrustedSourceTimestamp,
  type ExternalTransportConversationReference,
  type ExternalTransportInstanceReference,
  type ExternalTransportMessageReference,
  type ExternalTransportSenderReference,
  type UntrustedSourceTimestamp,
} from './communication-identity.js';

const OBSERVATION_FIELDS = Object.freeze([
  'transportInstanceReference',
  'externalMessageReference',
  'externalConversationReference',
  'externalSenderReference',
  'sourceTimestamp',
  'text',
] as const);

const FORBIDDEN_AUTHORITY_FIELDS = Object.freeze([
  'ownerId',
  'actorId',
  'conversationId',
  'turnId',
  'correlationId',
  'communicationIdempotencyKey',
  'idempotencyKey',
  'observedAt',
  'principal',
  'capability',
  'authenticatedPrincipal',
  'AuthenticatedCommunicationPrincipal',
] as const);

export interface TransportTextObservation {
  readonly transportInstanceReference: ExternalTransportInstanceReference;
  readonly externalMessageReference: ExternalTransportMessageReference;
  readonly externalConversationReference: ExternalTransportConversationReference;
  readonly externalSenderReference: ExternalTransportSenderReference;
  /** Untrusted metadata only; never used for ordering, authority, or idempotency. */
  readonly sourceTimestamp: UntrustedSourceTimestamp | null;
  readonly text: string;
}

export type TransportTextObservationFailureCode =
  | 'MALFORMED'
  | 'EXTRA_FIELD'
  | 'FORBIDDEN_FIELD'
  | 'INVALID_REFERENCE'
  | 'INVALID_TEXT'
  | 'INVALID_TIMESTAMP';

export interface TransportTextObservationFailure {
  readonly code: TransportTextObservationFailureCode;
  readonly reason: string;
}

const rejectForbiddenFields = (value: unknown): TransportTextObservationFailure | null => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  for (const field of FORBIDDEN_AUTHORITY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(value, field))
      return {
        code: 'FORBIDDEN_FIELD',
        reason: `Transport observation must not contain authority field "${field}".`,
      };
  }
  return null;
};

/**
 * Accepts only the exact channel-independent observation shape from an app-private adapter.
 * Raw SDK DTOs must not enter core.
 */
export const parseTransportTextObservation = (
  input: unknown,
): Result<TransportTextObservation, TransportTextObservationFailure> => {
  const forbidden = rejectForbiddenFields(input);
  if (forbidden !== null) return err(forbidden);

  const plain = exactPlainObservation(input, OBSERVATION_FIELDS);
  if (plain === null)
    return err({
      code: 'MALFORMED',
      reason: 'Transport observation must be an exact plain object with the required fields.',
    });

  const transportInstanceReference = parseExternalTransportInstanceReference(
    plain.transportInstanceReference,
  );
  const externalMessageReference = parseExternalTransportMessageReference(
    plain.externalMessageReference,
  );
  const externalConversationReference = parseExternalTransportConversationReference(
    plain.externalConversationReference,
  );
  const externalSenderReference = parseExternalTransportSenderReference(
    plain.externalSenderReference,
  );
  const sourceTimestamp = parseUntrustedSourceTimestamp(plain.sourceTimestamp);
  const text = normalizeAndValidateCommunicationText(
    plain.text,
    MAX_TRANSPORT_OBSERVATION_TEXT_UTF8_BYTES,
    'Transport observation text',
  );

  if (!transportInstanceReference.ok)
    return err({
      code: 'INVALID_REFERENCE',
      reason: transportInstanceReference.error.reason,
    });
  if (!externalMessageReference.ok)
    return err({
      code: 'INVALID_REFERENCE',
      reason: externalMessageReference.error.reason,
    });
  if (!externalConversationReference.ok)
    return err({
      code: 'INVALID_REFERENCE',
      reason: externalConversationReference.error.reason,
    });
  if (!externalSenderReference.ok)
    return err({
      code: 'INVALID_REFERENCE',
      reason: externalSenderReference.error.reason,
    });
  if (!sourceTimestamp.ok)
    return err({
      code: 'INVALID_TIMESTAMP',
      reason: sourceTimestamp.error.reason,
    });
  if (!text.ok)
    return err({
      code: 'INVALID_TEXT',
      reason: text.error.reason,
    });

  return ok(
    deepFreeze({
      transportInstanceReference: transportInstanceReference.value,
      externalMessageReference: externalMessageReference.value,
      externalConversationReference: externalConversationReference.value,
      externalSenderReference: externalSenderReference.value,
      sourceTimestamp: sourceTimestamp.value,
      text: text.value,
    }),
  );
};
