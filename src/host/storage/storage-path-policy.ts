import { posix as pathPosix, win32 as pathWin32 } from 'node:path';
import { type Result } from '../../core/domain/result.js';
import { failStorage } from './storage-failure.js';
import type { StorageFailure } from './storage-failure.js';

export type StoragePlatform = 'win32' | 'posix';

/**
 * Classic Windows reserved device basenames (case-insensitive), including stem before extension.
 * Similar names such as CONSOLE / COM10 / LPT10 remain allowed.
 */
const WINDOWS_RESERVED_DEVICE_BASENAME = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

/**
 * Lexical-only storage-root policy. Does not probe the filesystem, resolve symlinks,
 * or call cwd-dependent resolve helpers.
 */
export const validateStorageRootLexically = (
  platform: StoragePlatform,
  storageRoot: string,
): Result<string, StorageFailure> => {
  if (storageRoot.length === 0)
    return failStorage(
      'INVALID_STORAGE_ROOT',
      'Storage root must be a non-empty string.',
      'storageRoot',
    );
  if (storageRoot.includes('\0'))
    return failStorage(
      'UNSAFE_PATH',
      'Storage root must not contain NUL characters.',
      'storageRoot',
    );

  return platform === 'win32'
    ? validateWin32StorageRoot(storageRoot)
    : validatePosixStorageRoot(storageRoot);
};

const validateWin32StorageRoot = (storageRoot: string): Result<string, StorageFailure> => {
  // Fail-closed on forward slashes so mixed separators cannot change meaning.
  if (storageRoot.includes('/'))
    return failStorage(
      'UNSAFE_PATH',
      'Win32 storage root must use native separators only.',
      'storageRoot',
    );

  if (storageRoot.startsWith('\\\\'))
    return failStorage(
      'UNSAFE_PATH',
      'UNC and device-namespace storage roots are denied.',
      'storageRoot',
    );

  // Require drive + root separator (rejects relative and drive-relative forms).
  if (!/^[A-Za-z]:\\/.test(storageRoot))
    return failStorage(
      'UNSAFE_PATH',
      'Win32 storage root must be a local absolute drive path.',
      'storageRoot',
    );

  // After the drive letter prefix, additional colons enable ADS / alternate streams.
  if (storageRoot.slice(2).includes(':'))
    return failStorage(
      'UNSAFE_PATH',
      'Colon characters after the drive prefix are denied.',
      'storageRoot',
    );

  if (!pathWin32.isAbsolute(storageRoot))
    return failStorage(
      'UNSAFE_PATH',
      'Win32 storage root must be a local absolute drive path.',
      'storageRoot',
    );

  const normalized = pathWin32.normalize(storageRoot);
  if (normalized !== storageRoot)
    return failStorage(
      'UNSAFE_PATH',
      'Storage root must already be in normalized lexical form.',
      'storageRoot',
    );

  const parsed = pathWin32.parse(storageRoot);
  const relative = storageRoot.slice(parsed.root.length);
  if (relative.length === 0)
    return failStorage(
      'UNSAFE_PATH',
      'Storage root must include a directory under the drive root.',
      'storageRoot',
    );

  const segments = relative.split('\\');
  for (const segment of segments) {
    if (segment.length === 0)
      return failStorage('UNSAFE_PATH', 'Empty path segments are denied.', 'storageRoot');
    if (segment === '.' || segment === '..')
      return failStorage('UNSAFE_PATH', 'Raw dot path segments are denied.', 'storageRoot');
    if (/[. ]$/.test(segment))
      return failStorage(
        'UNSAFE_PATH',
        'Trailing spaces or dots in path segments are denied.',
        'storageRoot',
      );
    if (isWindowsReservedDeviceSegment(segment))
      return failStorage(
        'UNSAFE_PATH',
        'Windows reserved device names are denied in storage roots.',
        'storageRoot',
      );
  }

  return okPath(storageRoot);
};

const isWindowsReservedDeviceSegment = (segment: string): boolean => {
  const dot = segment.indexOf('.');
  const stem = dot === -1 ? segment : segment.slice(0, dot);
  return WINDOWS_RESERVED_DEVICE_BASENAME.test(stem);
};

const validatePosixStorageRoot = (storageRoot: string): Result<string, StorageFailure> => {
  if (storageRoot.startsWith('//'))
    return failStorage(
      'UNSAFE_PATH',
      'Network-like POSIX double-root paths are denied.',
      'storageRoot',
    );

  if (!storageRoot.startsWith('/') || !pathPosix.isAbsolute(storageRoot))
    return failStorage(
      'UNSAFE_PATH',
      'POSIX storage root must be a local absolute path.',
      'storageRoot',
    );

  if (storageRoot === '/')
    return failStorage(
      'UNSAFE_PATH',
      'Storage root must include a directory under the filesystem root.',
      'storageRoot',
    );

  const normalized = pathPosix.normalize(storageRoot);
  if (normalized !== storageRoot)
    return failStorage(
      'UNSAFE_PATH',
      'Storage root must already be in normalized lexical form.',
      'storageRoot',
    );

  if (storageRoot.endsWith('/'))
    return failStorage('UNSAFE_PATH', 'Trailing path separators are denied.', 'storageRoot');

  const segments = storageRoot.slice(1).split('/');
  for (const segment of segments) {
    if (segment.length === 0)
      return failStorage('UNSAFE_PATH', 'Empty path segments are denied.', 'storageRoot');
    if (segment === '.' || segment === '..')
      return failStorage('UNSAFE_PATH', 'Raw dot path segments are denied.', 'storageRoot');
  }

  return okPath(storageRoot);
};

const okPath = (storageRoot: string): Result<string, StorageFailure> => ({
  ok: true,
  value: storageRoot,
});
