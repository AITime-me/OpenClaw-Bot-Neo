import type { PayloadDigest } from '../../domain/identity.js';
import type { ValidatedTextOutput, ValidatedTextOutputSource } from './text-delivery.js';
import {
  getValidatedTextOutputCanonical,
  isValidatedTextOutput,
} from './text-delivery.internal.js';

/**
 * Persistence-only facade for validated text output (Build 3.7C0).
 *
 * Allowed importer (exact): host/storage/sqlite/communication/create-offline-sqlite-communication-ports.ts
 * Does not export sealer, registries, or unrestricted canonical getters.
 */

export { isValidatedTextOutput };

/** Safe metadata without plaintext body. */
export interface ValidatedTextOutputSafeMetadata {
  readonly source: ValidatedTextOutputSource;
  readonly payloadDigest: PayloadDigest;
  readonly byteLength: number;
}

export const verifyValidatedTextOutputForPersistence = (
  value: unknown,
): value is ValidatedTextOutput => isValidatedTextOutput(value);

export const readValidatedTextOutputSafeMetadata = (
  value: ValidatedTextOutput,
): ValidatedTextOutputSafeMetadata | null => {
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
  const canonical = getValidatedTextOutputCanonical(value);
  return canonical?.text ?? null;
};
