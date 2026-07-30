import { isProxy } from 'node:util/types';
import type { Result } from '../../../core/domain/result.js';
import { failStorage, okStorage, type StorageFailure } from '../storage-failure.js';
import { validateStorageRootLexically } from '../storage-path-policy.js';

export interface PosixStorageRootPolicy {
  /** Expected directory owner UID (service user). */
  readonly expectedUid: number;
  /**
   * Bits that may be set on the directory mode (st_mode & 0o7777).
   * Production recommendation: `0o700` — owner rwx only; group/world/special bits forbidden.
   * Owner rwx (`0o700`) is always required in addition to this mask.
   */
  readonly allowedModeBits: number;
  /**
   * Explicit trusted absolute POSIX path of the repository root for containment rejection.
   * Composition must supply this; cwd/home/env are never consulted.
   */
  readonly repositoryRoot: string;
}

const FIELD_KEYS = Object.freeze(['expectedUid', 'allowedModeBits', 'repositoryRoot']);

const isPlainObject = (value: object): boolean => {
  if (Array.isArray(value)) return false;
  const proto = Reflect.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/**
 * Parses an explicit POSIX storage-root security policy.
 * Does not read env, cwd, home, or process identity.
 */
export function parsePosixStorageRootPolicy(
  input: unknown,
): Result<PosixStorageRootPolicy, StorageFailure> {
  if (input === null || typeof input !== 'object')
    return failStorage('INVALID_STORAGE_POLICY', 'Storage policy must be a plain object.');
  if (isProxy(input))
    return failStorage('UNSAFE_STORAGE_INPUT', 'Storage policy must not be a Proxy.');
  if (!isPlainObject(input))
    return failStorage('INVALID_STORAGE_POLICY', 'Storage policy must be a plain object.');

  const ownNames = Reflect.ownKeys(input);
  for (const key of ownNames) {
    if (typeof key === 'symbol')
      return failStorage('UNSAFE_STORAGE_INPUT', 'Storage policy must not contain symbol keys.');
    if (!FIELD_KEYS.includes(key))
      return failStorage('UNKNOWN_STORAGE_FIELD', 'Storage policy contains an unknown field.', key);
  }
  for (const key of FIELD_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(input, key))
      return failStorage(
        'MISSING_STORAGE_FIELD',
        'Storage policy is missing a required field.',
        key,
      );
  }

  for (const key of FIELD_KEYS) {
    const descriptor = Reflect.getOwnPropertyDescriptor(input, key);
    if (
      descriptor === undefined ||
      typeof descriptor.get === 'function' ||
      typeof descriptor.set === 'function' ||
      typeof descriptor.value === 'function'
    )
      return failStorage(
        'UNSAFE_STORAGE_INPUT',
        'Storage policy fields must be data properties.',
        key,
      );
  }

  const record = input as Record<string, unknown>;
  const expectedUid = record['expectedUid'];
  const allowedModeBits = record['allowedModeBits'];
  const repositoryRoot = record['repositoryRoot'];

  if (
    typeof expectedUid !== 'number' ||
    !Number.isInteger(expectedUid) ||
    expectedUid < 0 ||
    expectedUid > 0xffffffff
  )
    return failStorage(
      'INVALID_STORAGE_POLICY',
      'expectedUid must be a non-negative integer UID.',
      'expectedUid',
    );

  if (
    typeof allowedModeBits !== 'number' ||
    !Number.isInteger(allowedModeBits) ||
    allowedModeBits < 0 ||
    allowedModeBits > 0o7777
  )
    return failStorage(
      'INVALID_STORAGE_POLICY',
      'allowedModeBits must be an integer in 0..0o7777.',
      'allowedModeBits',
    );

  if ((allowedModeBits & 0o700) !== 0o700)
    return failStorage(
      'INVALID_STORAGE_POLICY',
      'allowedModeBits must include owner read/write/execute.',
      'allowedModeBits',
    );

  if (typeof repositoryRoot !== 'string' || repositoryRoot.length === 0)
    return failStorage(
      'INVALID_STORAGE_POLICY',
      'repositoryRoot must be a non-empty string.',
      'repositoryRoot',
    );

  const lexical = validateStorageRootLexically('posix', repositoryRoot);
  if (!lexical.ok) {
    return failStorage(
      'INVALID_STORAGE_POLICY',
      'repositoryRoot failed POSIX lexical path validation.',
      'repositoryRoot',
    );
  }

  return okStorage(
    Object.freeze({
      expectedUid,
      allowedModeBits,
      repositoryRoot: lexical.value,
    }),
  );
}
