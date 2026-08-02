import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, statSync, type Stats } from 'node:fs';

export type FileFingerprint = {
  readonly exists: boolean;
  readonly size: number;
  readonly mtimeMs: number;
  readonly inode: number;
  readonly device: number;
  readonly mode: number;
  readonly nlink: number;
  readonly fileType: 'file' | 'directory' | 'symlink' | 'other' | 'missing';
};

export const fingerprintFile = (absolutePath: string): FileFingerprint => {
  try {
    const stats: Stats = lstatSync(absolutePath);
    const fileType = stats.isSymbolicLink()
      ? 'symlink'
      : stats.isFile()
        ? 'file'
        : stats.isDirectory()
          ? 'directory'
          : 'other';
    return {
      exists: true,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      inode: stats.ino,
      device: stats.dev,
      mode: stats.mode & 0o7777,
      nlink: stats.nlink,
      fileType,
    };
  } catch {
    return {
      exists: false,
      size: 0,
      mtimeMs: 0,
      inode: 0,
      device: 0,
      mode: 0,
      nlink: 0,
      fileType: 'missing',
    };
  }
};

/** Stable fields only — excludes mtime (WAL/overlayfs noise). */
export const fingerprintsStableEqual = (left: FileFingerprint, right: FileFingerprint): boolean =>
  left.exists === right.exists &&
  left.size === right.size &&
  left.inode === right.inode &&
  left.device === right.device &&
  left.mode === right.mode &&
  left.fileType === right.fileType;

export const fingerprintsEqual = (left: FileFingerprint, right: FileFingerprint): boolean =>
  fingerprintsStableEqual(left, right) && Math.abs(left.mtimeMs - right.mtimeMs) < 0.002;

export const hashPackageLock = (packageLockPath: string): string => {
  const content = readFileSync(packageLockPath);
  return createHash('sha256').update(content).digest('hex');
};

export const hashCapability = (capability: string): string =>
  createHash('sha256').update(capability, 'utf8').digest('hex');

export const hashOpaqueId = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);

export const statFileMode = (absolutePath: string): number | null => {
  try {
    return statSync(absolutePath).mode & 0o7777;
  } catch {
    return null;
  }
};
