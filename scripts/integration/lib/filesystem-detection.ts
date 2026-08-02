const REJECTED_FS_TYPES = new Set(['nfs', 'nfs4', 'cifs', 'smb', 'fuse']);

export type ProcMountEntry = {
  readonly mountPoint: string;
  readonly type: string;
};

export type FilesystemDetectionResult = {
  readonly type: string;
  readonly localVerified: boolean;
  readonly overlayFilesystem: boolean;
  readonly matchedMountPoint: string | null;
};

/** Decode octal escape sequences used in /proc/mounts paths (e.g. \\040). */
export const unescapeProcMountsPath = (encoded: string): string | null => {
  if (encoded.length === 0) return null;
  let result = '';
  for (let index = 0; index < encoded.length; index++) {
    const ch = encoded[index];
    if (ch === undefined) return null;
    if (ch === '\\' && index + 3 < encoded.length) {
      const digits = encoded.slice(index + 1, index + 4);
      if (/^[0-7]{3}$/.test(digits)) {
        result += String.fromCharCode(Number.parseInt(digits, 8));
        index += 3;
        continue;
      }
    }
    result += ch;
  }
  return result;
};

/** Normalize mount points; root stays `/`, trailing slashes removed elsewhere. */
export const normalizeMountPoint = (mountPoint: string): string | null => {
  if (mountPoint.length === 0) return null;
  if (!mountPoint.startsWith('/')) return null;
  if (mountPoint === '/') return '/';
  const trimmed = mountPoint.replace(/\/+$/, '');
  return trimmed.length === 0 ? '/' : trimmed;
};

/** Normalize absolute POSIX paths without host-specific drive-letter resolution. */
export const normalizePosixAbsolutePath = (targetPath: string): string | null => {
  if (targetPath.length === 0 || !targetPath.startsWith('/')) return null;
  if (targetPath === '/') return '/';
  const segments: string[] = [];
  for (const segment of targetPath.split('/')) {
    if (segment.length === 0 || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
};

/**
 * True when candidatePath is on mountPoint by exact match or path-component boundary.
 * Relative candidates fail closed.
 */
export const isPathWithinMount = (candidatePath: string, mountPoint: string): boolean => {
  if (candidatePath.length === 0 || mountPoint.length === 0) return false;
  if (!candidatePath.startsWith('/')) return false;

  const normalizedMount = normalizeMountPoint(mountPoint);
  if (normalizedMount === null) return false;

  if (normalizedMount === '/') {
    return candidatePath.startsWith('/');
  }
  if (candidatePath === normalizedMount) return true;
  return candidatePath.startsWith(`${normalizedMount}/`);
};

export const parseProcMounts = (content: string): readonly ProcMountEntry[] => {
  const entries: ProcMountEntry[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const parts = trimmed.split(' ');
    if (parts.length < 3) continue;
    const mountPointRaw = parts[1];
    const type = parts[2];
    if (mountPointRaw === undefined || type === undefined) continue;
    const unescaped = unescapeProcMountsPath(mountPointRaw);
    if (unescaped === null) continue;
    const mountPoint = normalizeMountPoint(unescaped);
    if (mountPoint === null) continue;
    entries.push({ mountPoint, type });
  }
  return entries;
};

export const detectFilesystemFromMounts = (
  targetPath: string,
  mountsContent: string,
): FilesystemDetectionResult => {
  const unknown: FilesystemDetectionResult = {
    type: 'unknown',
    localVerified: false,
    overlayFilesystem: false,
    matchedMountPoint: null,
  };

  const resolved = normalizePosixAbsolutePath(targetPath);
  if (resolved === null) return unknown;

  let bestLen = 0;
  let fsType = 'unknown';
  let matchedMountPoint: string | null = null;

  for (const { mountPoint, type } of parseProcMounts(mountsContent)) {
    if (!isPathWithinMount(resolved, mountPoint)) continue;
    if (mountPoint.length >= bestLen) {
      bestLen = mountPoint.length;
      fsType = type;
      matchedMountPoint = mountPoint;
    }
  }

  const localVerified = fsType !== 'unknown' && !REJECTED_FS_TYPES.has(fsType);
  const overlayFilesystem = fsType === 'overlay' || fsType === 'overlayfs';
  return { type: fsType, localVerified, overlayFilesystem, matchedMountPoint };
};

export const isRejectedFilesystemType = (fsType: string): boolean => REJECTED_FS_TYPES.has(fsType);
