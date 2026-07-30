import type { Result } from '../../../core/domain/result.js';
import { failStorage, okStorage, type StorageFailure } from '../storage-failure.js';

/**
 * Runtime capability seal for a successful POSIX storage-root open (Build 3.3B2B).
 *
 * Trust is module-private WeakMap membership by object identity — not object shape,
 * freeze status, TypeScript brands, Symbol properties, or caller-controlled markers.
 *
 * Not a secret, credential, filesystem lock, exclusive lock, cross-process token,
 * transferable serialized token, or TOCTOU/privileged-attacker proof.
 *
 * Visibility: app-private. Only `open-posix-storage-root.ts` may register/retire.
 * Resolve is reserved for a future dedicated SQLite adapter (allowlisted in B2) and tests.
 * Not re-exported from host/storage barrels or the package root.
 */

/** Lifecycle states present in the authority registry after successful construction. */
export type PosixStorageRootCapabilityState = 'open' | 'retired' | 'closed';

/**
 * Minimal trusted authority recorded only after all B1 checks and success-object construction.
 * Never exposed as a property of the public result; never returned raw from the resolver.
 */
interface TrustedPosixStorageRootAuthority {
  readonly storageRootPath: string;
  state: PosixStorageRootCapabilityState;
}

/** Frozen view returned to a trusted internal storage consumer. */
export interface ResolvedPosixStorageRootCapability {
  readonly storageRootPath: string;
  readonly lifecycleState: 'open';
}

const capabilityRegistry = new WeakMap<object, TrustedPosixStorageRootAuthority>();

/**
 * Registers a genuine successful OpenedPosixStorageRoot as an open capability.
 * Must be called only after the success object is fully constructed and frozen.
 * Double-registration is a programmer error.
 */
export const registerOpenedPosixStorageRootCapability = (
  capabilityKey: object,
  storageRootPath: string,
): void => {
  if (typeof storageRootPath !== 'string' || storageRootPath.length === 0)
    throw new TypeError('Storage root capability path must be a non-empty string.');
  if (capabilityRegistry.has(capabilityKey))
    throw new TypeError('OpenedPosixStorageRoot capability is already registered.');
  capabilityRegistry.set(capabilityKey, {
    storageRootPath,
    state: 'open',
  });
};

/**
 * Transitions open → retired on first close attempt.
 * Idempotent for already-retired/closed. Never returns to open.
 */
export const retireOpenedPosixStorageRootCapability = (capabilityKey: object): void => {
  const authority = capabilityRegistry.get(capabilityKey);
  if (authority === undefined) return;
  if (authority.state === 'open') authority.state = 'retired';
};

/**
 * Transitions to closed after a successful system close.
 * Resolver remains fail-closed. Never returns to open.
 */
export const markOpenedPosixStorageRootCapabilityClosed = (capabilityKey: object): void => {
  const authority = capabilityRegistry.get(capabilityKey);
  if (authority === undefined) return;
  authority.state = 'closed';
};

/**
 * Abandons a capability that was registered but must not be returned to the caller
 * (registration/construction failure after WeakMap insert). Fail-closed permanently.
 */
export const abandonOpenedPosixStorageRootCapability = (capabilityKey: object): void => {
  const authority = capabilityRegistry.get(capabilityKey);
  if (authority === undefined) return;
  authority.state = 'closed';
};

/**
 * Resolves a genuine open storage-root capability to the trusted root path.
 *
 * Before WeakMap identity validation only null/typeof checks and WeakMap.has/get are used —
 * no property access, keys, descriptors, spread, JSON, String(), or prototype inspection.
 */
export const resolveOpenedPosixStorageRootCapability = (
  value: unknown,
): Result<ResolvedPosixStorageRootCapability, StorageFailure> => {
  if (value === null || typeof value !== 'object')
    return failStorage('STORAGE_ROOT_CAPABILITY_INVALID', 'Storage root capability is invalid.');

  const authority = capabilityRegistry.get(value);
  if (authority === undefined)
    return failStorage('STORAGE_ROOT_CAPABILITY_INVALID', 'Storage root capability is invalid.');

  if (authority.state !== 'open')
    return failStorage(
      'STORAGE_ROOT_CAPABILITY_UNAVAILABLE',
      'Storage root capability is no longer available.',
    );

  return okStorage(
    Object.freeze({
      storageRootPath: authority.storageRootPath,
      lifecycleState: 'open' as const,
    }),
  );
};
