import type { Result } from '../../../core/domain/result.js';
import { failStorage, okStorage, type StorageFailure } from '../storage-failure.js';

/**
 * Runtime capability seal for a successful POSIX storage-root open (Build 3.3B2B / B3A).
 *
 * Trust is module-private WeakMap membership by object identity — not object shape,
 * freeze status, TypeScript brands, Symbol properties, or caller-controlled markers.
 *
 * Not a secret, credential, filesystem lock, exclusive lock, cross-process token,
 * transferable serialized token, or TOCTOU/privileged-attacker proof.
 *
 * Visibility: app-private. Only `open-posix-storage-root.ts` may register / prepare-close /
 * markClosed / abandon. Resolve is re-exported through `posix-storage-root-resolve.internal.ts`.
 * Lease acquisition is re-exported through `posix-storage-root-lease.internal.ts` for the exact
 * SQLite MemoryPort factory. Not re-exported from host/storage barrels or the package root.
 */

/** Lifecycle states present in the authority registry after successful construction. */
export type PosixStorageRootCapabilityState = 'open' | 'retired' | 'closed';

/**
 * Minimal trusted authority recorded only after all B1 checks and success-object construction.
 * Never exposed as a property of the public result; never returned raw from the resolver.
 * `activeLeaseCount` tracks same-process child adapter leases (not a process lock).
 */
interface TrustedPosixStorageRootAuthority {
  readonly storageRootPath: string;
  state: PosixStorageRootCapabilityState;
  activeLeaseCount: number;
}

/** Frozen view returned to a trusted internal storage consumer. */
export interface ResolvedPosixStorageRootCapability {
  readonly storageRootPath: string;
  readonly lifecycleState: 'open';
}

/**
 * App-private child lease for a genuine open storage root.
 * Not a secret, credential, process lock, exclusive lock, or transferable token.
 */
export interface AcquiredPosixStorageRootLease {
  readonly storageRootPath: string;
  /** Idempotent release; safe after successful adapter DB close. Pure (no I/O). */
  readonly release: () => void;
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
    activeLeaseCount: 0,
  });
};

/**
 * Atomically prepares a genuine open root for filesystem close.
 *
 * - Invalid identity → CAPABILITY_INVALID (no state change).
 * - Already retired/closed → ok (idempotent prepare; caller may continue B1 close/retry).
 * - Open with active child leases → CLOSE_BUSY (lifecycle unchanged; no retire).
 * - Open with zero leases → atomically open → retired, then ok.
 *
 * Never returns a retired/closed root to open. Does not close directory handles.
 */
export const prepareOpenedPosixStorageRootClose = (
  capabilityKey: object,
): Result<void, StorageFailure> => {
  const authority = capabilityRegistry.get(capabilityKey);
  if (authority === undefined)
    return failStorage('STORAGE_ROOT_CAPABILITY_INVALID', 'Storage root capability is invalid.');

  if (authority.state === 'retired' || authority.state === 'closed') return okStorage(undefined);

  if (authority.activeLeaseCount > 0)
    return failStorage(
      'STORAGE_ROOT_CLOSE_BUSY',
      'Storage root is in use by an open storage adapter.',
    );

  authority.state = 'retired';
  return okStorage(undefined);
};

/**
 * Transitions open → retired without lease gating.
 * Production root.close must use {@link prepareOpenedPosixStorageRootClose} instead.
 * Kept for forced abandon/edge paths. Idempotent for already-retired/closed. Never returns to open.
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

/**
 * Acquires a child lease on a genuine open storage-root capability.
 *
 * Combines identity validation, open-state check, path resolution, and lease increment
 * into one atomic synchronous operation. Does not read caller properties before WeakMap lookup.
 * Forged / cloned / Proxy / revoked Proxy values are rejected without trap execution.
 */
export const acquireOpenedPosixStorageRootLease = (
  value: unknown,
): Result<AcquiredPosixStorageRootLease, StorageFailure> => {
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

  authority.activeLeaseCount += 1;
  let released = false;

  const release = (): void => {
    if (released) return;
    released = true;
    if (authority.activeLeaseCount <= 0)
      throw new TypeError('Storage root lease release count underflow.');
    authority.activeLeaseCount -= 1;
  };

  return okStorage(
    Object.freeze({
      storageRootPath: authority.storageRootPath,
      release,
    }),
  );
};
