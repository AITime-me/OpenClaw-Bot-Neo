import { realpathSync, existsSync, mkdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, resolve, sep } from 'node:path';

export type IsolationPaths = {
  readonly codexHome: string;
  readonly home: string;
  readonly tempDir: string;
  readonly probeCwd: string;
  readonly repositoryRoot: string;
};

export type IsolationResult =
  | { readonly ok: true; readonly paths: IsolationPaths }
  | { readonly ok: false; readonly reason: string };

const tryRealpath = (absolutePath: string): string | null => {
  try {
    return realpathSync(absolutePath);
  } catch {
    return null;
  }
};

export const canonicalizeAbsolutePath = (value: string): string | null => {
  if (!isAbsolute(value)) return null;
  if (value.includes('\0')) return null;
  const resolved = resolve(value);
  const real = tryRealpath(resolved);
  return real ?? resolved;
};

export const pathEquals = (left: string, right: string): boolean => {
  if (process.platform === 'win32') return left.toLowerCase() === right.toLowerCase();
  return left === right;
};

export const isUnderOrEqual = (child: string, parent: string): boolean => {
  if (pathEquals(child, parent)) return true;
  const prefix = parent.endsWith(sep) ? parent : `${parent}${sep}`;
  if (process.platform === 'win32') return child.toLowerCase().startsWith(prefix.toLowerCase());
  return child.startsWith(prefix);
};

/** True when either path equals or nests under the other. */
export const pathsOverlapBidirectional = (left: string, right: string): boolean =>
  isUnderOrEqual(left, right) || isUnderOrEqual(right, left);

/**
 * Build and validate an isolated probe contour. Homes/temp/cwd must be canonical,
 * under the isolated CODEX_HOME tree, and must not collide with developer/shared homes
 * or the repository root (bidirectional overlap).
 */
export const buildIsolatedProbeContour = (input: {
  readonly codexHome: string;
  readonly home?: string;
  readonly tempDir?: string;
  readonly probeCwd?: string;
  readonly repositoryRoot: string;
}): IsolationResult => {
  const repositoryRoot = canonicalizeAbsolutePath(input.repositoryRoot);
  if (repositoryRoot === null)
    return { ok: false, reason: 'repositoryRoot must be an absolute path' };

  const codexHome = canonicalizeAbsolutePath(input.codexHome);
  if (codexHome === null) return { ok: false, reason: 'CODEX_HOME must be absolute/canonical' };

  const home = canonicalizeAbsolutePath(input.home ?? input.codexHome);
  if (home === null) return { ok: false, reason: 'HOME must be absolute/canonical' };

  const tempDir = canonicalizeAbsolutePath(input.tempDir ?? resolve(codexHome, 'tmp'));
  if (tempDir === null) return { ok: false, reason: 'tempDir must be absolute/canonical' };

  const probeCwd = canonicalizeAbsolutePath(input.probeCwd ?? resolve(codexHome, 'cwd'));
  if (probeCwd === null) return { ok: false, reason: 'probeCwd must be absolute/canonical' };

  const developerHome = canonicalizeAbsolutePath(homedir());
  const developerCodex = developerHome !== null ? resolve(developerHome, '.codex') : null;
  const systemTemp = canonicalizeAbsolutePath(tmpdir());

  const exactBanned = [developerHome, developerCodex, systemTemp].filter(
    (value): value is string => value !== null,
  );

  const paths = { codexHome, home, tempDir, probeCwd };
  for (const [label, pathValue] of Object.entries(paths)) {
    for (const banned of exactBanned) {
      if (pathEquals(pathValue, banned))
        return {
          ok: false,
          reason: `${label} collides with developer/shared path`,
        };
    }
    // Repository overlap is checked in both directions (nesting either way is forbidden).
    if (pathsOverlapBidirectional(pathValue, repositoryRoot))
      return {
        ok: false,
        reason: `${label} overlaps repository root`,
      };
  }

  if (!isUnderOrEqual(home, codexHome) && !pathEquals(home, codexHome))
    return { ok: false, reason: 'HOME must equal or nest under isolated CODEX_HOME' };
  if (!isUnderOrEqual(tempDir, codexHome))
    return { ok: false, reason: 'tempDir must nest under isolated CODEX_HOME' };
  if (!isUnderOrEqual(probeCwd, codexHome))
    return { ok: false, reason: 'probeCwd must nest under isolated CODEX_HOME' };
  if (pathEquals(probeCwd, codexHome))
    return { ok: false, reason: 'probeCwd must be a dedicated empty directory, not CODEX_HOME' };

  for (const dir of [codexHome, home, tempDir, probeCwd]) {
    if (!existsSync(dir)) {
      try {
        mkdirSync(dir, { recursive: true });
      } catch {
        return { ok: false, reason: `unable to create isolated path: ${dir}` };
      }
    }
  }

  return {
    ok: true,
    paths: { codexHome, home, tempDir, probeCwd, repositoryRoot },
  };
};

/** Model-readable roots: only the dedicated empty probe cwd (never CODEX_HOME/credentials/repo). */
export const readableRootsForProbe = (paths: IsolationPaths): readonly string[] => [paths.probeCwd];

export const validateModelReadableRoots = (
  roots: readonly string[],
  paths: IsolationPaths,
): IsolationResult => {
  if (roots.length !== 1)
    return { ok: false, reason: 'model-readable roots must be exactly the probe cwd' };
  const only = roots[0];
  if (only === undefined || !pathEquals(only, paths.probeCwd))
    return { ok: false, reason: 'model-readable roots must equal isolated probe cwd' };

  const developerHome = canonicalizeAbsolutePath(homedir());
  const developerCodex = developerHome !== null ? resolve(developerHome, '.codex') : null;
  const credentialsDir = resolve(paths.codexHome, 'auth');
  const credentialsFile = resolve(paths.codexHome, 'auth.json');

  const mustNotEqualOrCover = [
    paths.codexHome,
    paths.home,
    paths.tempDir,
    credentialsDir,
    credentialsFile,
    paths.repositoryRoot,
    developerHome,
    developerCodex,
  ].filter((value): value is string => value !== null);

  for (const banned of mustNotEqualOrCover) {
    if (pathEquals(only, banned))
      return {
        ok: false,
        reason: 'readable root must not equal CODEX_HOME/credentials/repository/shared path',
      };
    if (isUnderOrEqual(banned, only) && !pathEquals(banned, only))
      return {
        ok: false,
        reason: 'readable root must not cover CODEX_HOME/credentials/repository/shared path',
      };
  }

  if (pathsOverlapBidirectional(only, paths.repositoryRoot))
    return { ok: false, reason: 'readable root overlaps repository' };
  if (developerHome !== null && pathEquals(only, developerHome))
    return { ok: false, reason: 'readable root must not equal shared developer home' };
  if (developerCodex !== null && pathEquals(only, developerCodex))
    return { ok: false, reason: 'readable root must not equal shared Codex home' };

  return { ok: true, paths };
};
