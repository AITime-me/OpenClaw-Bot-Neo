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

const pathEquals = (left: string, right: string): boolean => {
  if (process.platform === 'win32') return left.toLowerCase() === right.toLowerCase();
  return left === right;
};

const isUnderOrEqual = (child: string, parent: string): boolean => {
  if (pathEquals(child, parent)) return true;
  const prefix = parent.endsWith(sep) ? parent : `${parent}${sep}`;
  if (process.platform === 'win32') return child.toLowerCase().startsWith(prefix.toLowerCase());
  return child.startsWith(prefix);
};

/**
 * Build and validate an isolated probe contour. Homes/temp/cwd must be canonical,
 * under the isolated CODEX_HOME tree, and must not collide with developer/shared homes
 * or the repository root.
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

  const bannedExact = [developerHome, developerCodex, systemTemp, repositoryRoot].filter(
    (value): value is string => value !== null,
  );

  const paths = { codexHome, home, tempDir, probeCwd };
  for (const [label, pathValue] of Object.entries(paths)) {
    for (const banned of bannedExact) {
      if (pathEquals(pathValue, banned))
        return {
          ok: false,
          reason: `${label} collides with developer/shared/repository path`,
        };
    }
    if (isUnderOrEqual(pathValue, repositoryRoot))
      return {
        ok: false,
        reason: `${label} must not nest under repository root`,
      };
  }

  if (!isUnderOrEqual(home, codexHome) && !pathEquals(home, codexHome))
    return { ok: false, reason: 'HOME must equal or nest under isolated CODEX_HOME' };
  if (!isUnderOrEqual(tempDir, codexHome))
    return { ok: false, reason: 'tempDir must nest under isolated CODEX_HOME' };
  if (!isUnderOrEqual(probeCwd, codexHome))
    return { ok: false, reason: 'probeCwd must nest under isolated CODEX_HOME' };

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

export const readableRootsForProbe = (paths: IsolationPaths): readonly string[] => [
  paths.codexHome,
  paths.probeCwd,
];
