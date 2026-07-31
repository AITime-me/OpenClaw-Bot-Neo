import type { DomainError } from '../core/domain/errors.js';

/**
 * Authoritative not-found failure for MemoryPort adapters (in-memory and SQLite).
 * Not re-exported from the package root.
 */
export const memoryRecordNotFound = (): DomainError =>
  Object.freeze({
    code: 'VALIDATION_FAILED',
    reason: 'Memory record not found in ephemeral local store.',
  });
