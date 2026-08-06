import { ok, type Result } from '../../domain/result.js';
import { communicationError, type CommunicationError } from '../domain/communication-errors.js';

export type CommunicationRuntimeOwnershipHandle = {
  readonly ownershipKey: string;
  readonly release: () => void;
};

const holders = new Map<string, symbol>();

/**
 * In-process exclusive ownership for one communication persistence/ledger.
 * Crash/process exit clears the Map so the next process is not permanently blocked.
 * Schema-independent (no SQLite migration).
 */
export const tryAcquireCommunicationRuntimeOwnership = (
  ownershipKey: string,
): Result<CommunicationRuntimeOwnershipHandle, CommunicationError> => {
  if (typeof ownershipKey !== 'string' || ownershipKey.length === 0)
    return {
      ok: false,
      error: communicationError('CONFIG_INVALID', 'Runtime ownershipKey is required.'),
    };
  if (holders.has(ownershipKey))
    return {
      ok: false,
      error: communicationError(
        'CONFIG_INVALID',
        'Communication runtime ownership is already held for this ledger.',
      ),
    };
  const token = Symbol(ownershipKey);
  holders.set(ownershipKey, token);
  let released = false;
  return ok({
    ownershipKey,
    release: () => {
      if (released) return;
      if (holders.get(ownershipKey) === token) holders.delete(ownershipKey);
      released = true;
    },
  });
};

/** Test-only: clear all ownership (never call from production paths). */
export const resetCommunicationRuntimeOwnershipForTests = (): void => {
  holders.clear();
};
