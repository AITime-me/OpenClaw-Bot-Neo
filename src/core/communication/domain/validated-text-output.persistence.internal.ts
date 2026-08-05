import type { PayloadDigest } from '../../domain/identity.js';
import type { ValidatedTextOutput, ValidatedTextOutputSource } from './text-delivery.js';
import {
  getValidatedTextOutputCanonical,
  isValidatedTextOutput,
} from './text-delivery.internal.js';

/**
 * Persistence-only facade for validated text output (Build 3.7C0).
 *
 * Exact export surface only. Allowed importer (exact):
 * host/storage/sqlite/communication/create-offline-sqlite-communication-ports.ts
 *
 * Does not re-export original internals, sealer, registries, or unrestricted canonical getters.
 */

/** Safe metadata without plaintext body. */
export interface ValidatedTextOutputPersistenceMetadata {
  readonly source: ValidatedTextOutputSource;
  readonly payloadDigest: PayloadDigest;
  readonly byteLength: number;
}

export const isGenuineValidatedTextOutputForPersistence = (
  value: unknown,
): value is ValidatedTextOutput => isValidatedTextOutput(value);

export const readValidatedTextOutputMetadataForPersistence = (
  value: ValidatedTextOutput,
): ValidatedTextOutputPersistenceMetadata | null => {
  const canonical = getValidatedTextOutputCanonical(value);
  if (canonical === null) return null;
  return Object.freeze({
    source: canonical.source,
    payloadDigest: canonical.payloadDigest,
    byteLength: canonical.byteLength,
  });
};

/**
 * Plaintext body for offline outbox persistence only.
 * Must not be used for live/encrypted delivery paths.
 */
export const readValidatedTextOutputPlaintextForOfflineOutbox = (
  value: ValidatedTextOutput,
): string | null => {
  if (!isValidatedTextOutput(value)) return null;
  const canonical = getValidatedTextOutputCanonical(value);
  return canonical?.text ?? null;
};
