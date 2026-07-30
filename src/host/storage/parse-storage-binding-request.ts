import { isProxy } from 'node:util/types';
import { type Result } from '../../core/domain/result.js';
import { failStorage, okStorage } from './storage-failure.js';
import type { StorageFailure } from './storage-failure.js';
import { validateStorageRootLexically, type StoragePlatform } from './storage-path-policy.js';

const FIELD_KEYS = Object.freeze(['platform', 'storageRoot'] as const);

export interface StorageBindingRequest {
  readonly platform: StoragePlatform;
  readonly storageRoot: string;
}

/**
 * Plain-object check for already non-Proxy values. Callers must reject Proxies with
 * `util.types.isProxy` before invoking this helper so `instanceof` / `getPrototypeOf`
 * cannot fire user traps.
 */
const isPlainObject = (value: object): boolean => {
  if (Array.isArray(value)) return false;
  if (value instanceof Date || value instanceof Map || value instanceof Set) return false;
  if (value instanceof WeakMap || value instanceof WeakSet || value instanceof RegExp) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const readOwnDataProperty = (container: object, key: string): Result<unknown, StorageFailure> => {
  if (Object.getOwnPropertySymbols(container).length > 0)
    return failStorage('UNSAFE_STORAGE_INPUT', 'Storage request must not contain symbol keys.');
  const descriptor = Object.getOwnPropertyDescriptor(container, key);
  if (descriptor === undefined)
    return failStorage('MISSING_STORAGE_FIELD', 'Required storage field is missing.', key);
  if (descriptor.get !== undefined || descriptor.set !== undefined)
    return failStorage('UNSAFE_STORAGE_INPUT', 'Storage accessors are denied.', key);
  if (typeof descriptor.value === 'function')
    return failStorage('UNSAFE_STORAGE_INPUT', 'Storage methods are denied.', key);
  return okStorage(descriptor.value);
};

/**
 * Pure storage binding request parser. Accepts an explicit plain object with `platform`
 * and `storageRoot` only. No filesystem, env, cwd, or home resolution.
 */
export function parseStorageBindingRequest(
  input: unknown,
): Result<StorageBindingRequest, StorageFailure> {
  if (input === null || typeof input !== 'object')
    return failStorage(
      'INVALID_STORAGE_REQUEST',
      'Storage binding request must be a plain object.',
    );
  if (isProxy(input))
    return failStorage('UNSAFE_STORAGE_INPUT', 'Proxy storage requests are denied.');
  if (!isPlainObject(input))
    return failStorage(
      'INVALID_STORAGE_REQUEST',
      'Storage binding request must be a plain object.',
    );

  if (Object.getOwnPropertySymbols(input).length > 0)
    return failStorage('UNSAFE_STORAGE_INPUT', 'Storage request must not contain symbol keys.');

  for (const key of Object.getOwnPropertyNames(input)) {
    if (!(FIELD_KEYS as readonly string[]).includes(key))
      return failStorage('UNKNOWN_STORAGE_FIELD', 'Unknown storage binding field is denied.', key);
  }

  for (const required of FIELD_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(input, required))
      return failStorage('MISSING_STORAGE_FIELD', 'Required storage field is missing.', required);
  }

  const platformRaw = readOwnDataProperty(input, 'platform');
  if (!platformRaw.ok) return platformRaw;
  const storageRootRaw = readOwnDataProperty(input, 'storageRoot');
  if (!storageRootRaw.ok) return storageRootRaw;

  if (platformRaw.value === undefined)
    return failStorage('INVALID_PLATFORM', 'Platform must be win32 or posix.', 'platform');
  if (storageRootRaw.value === undefined)
    return failStorage(
      'INVALID_STORAGE_ROOT',
      'Storage root must be a non-empty string.',
      'storageRoot',
    );

  if (platformRaw.value !== 'win32' && platformRaw.value !== 'posix')
    return failStorage('INVALID_PLATFORM', 'Platform must be win32 or posix.', 'platform');
  const platform: StoragePlatform = platformRaw.value;

  if (typeof storageRootRaw.value !== 'string')
    return failStorage(
      'INVALID_STORAGE_ROOT',
      'Storage root must be a non-empty string.',
      'storageRoot',
    );

  const pathResult = validateStorageRootLexically(platform, storageRootRaw.value);
  if (!pathResult.ok) return pathResult;

  return okStorage(
    Object.freeze({
      platform,
      storageRoot: pathResult.value,
    }),
  );
}
