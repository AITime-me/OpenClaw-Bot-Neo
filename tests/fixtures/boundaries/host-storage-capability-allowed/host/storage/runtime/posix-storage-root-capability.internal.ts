import type { Result } from '../../../core/domain/result.js';

export const registerOpenedPosixStorageRootCapability = (_key: object, _path: string): void =>
  undefined;

export const resolveOpenedPosixStorageRootCapability = (
  _value: unknown,
): Result<{ readonly storageRootPath: string }, { readonly code: string }> => ({
  ok: false,
  error: { code: 'STORAGE_ROOT_CAPABILITY_INVALID' },
});
