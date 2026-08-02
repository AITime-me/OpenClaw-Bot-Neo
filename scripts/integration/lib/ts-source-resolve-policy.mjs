/**
 * Pure predicates for TypeScript source `.js` → `.ts` resolve fallback.
 * Shared by the loader hook and focused unit tests.
 */
import { lstatSync, realpathSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * @param {string} candidate
 * @param {string} root
 * @returns {boolean}
 */
export const isPathInsideRoot = (candidate, root) => {
  const normalize = (value) => value.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedCandidate = normalize(candidate);
  const normalizedRoot = normalize(root);
  if (normalizedCandidate === normalizedRoot) return true;
  return normalizedCandidate.startsWith(`${normalizedRoot}/`);
};

/**
 * @param {string} specifier
 * @returns {boolean}
 */
export const isRelativeJsSpecifier = (specifier) => {
  if (typeof specifier !== 'string') return false;
  if (!(specifier.startsWith('./') || specifier.startsWith('../'))) return false;
  if (specifier.includes('?') || specifier.includes('#')) return false;
  if (!specifier.endsWith('.js')) return false;
  if (specifier.endsWith('.mjs') || specifier.endsWith('.cjs')) return false;
  return true;
};

/**
 * @param {unknown} parentURL
 * @returns {string | null}
 */
export const parentFilePathFromURL = (parentURL) => {
  if (typeof parentURL !== 'string' && !(parentURL instanceof URL)) return null;
  const href = typeof parentURL === 'string' ? parentURL : parentURL.href;
  if (!href.startsWith('file:')) return null;
  try {
    return fileURLToPath(href);
  } catch {
    return null;
  }
};

/**
 * Attempt `.js` → `.ts` fallback after normal resolution failed with ERR_MODULE_NOT_FOUND.
 * @param {{
 *   specifier: string,
 *   parentURL: string | URL | undefined,
 *   srcRoot: string,
 * }} input
 * @returns {{ ok: true, url: string } | { ok: false }}
 */
export const tryResolveTsSourceFallback = (input) => {
  const { specifier, parentURL, srcRoot } = input;
  if (typeof srcRoot !== 'string' || srcRoot.length === 0) return { ok: false };
  if (!isRelativeJsSpecifier(specifier)) return { ok: false };

  const parentPath = parentFilePathFromURL(parentURL);
  if (parentPath === null) return { ok: false };

  let parentReal;
  try {
    parentReal = realpathSync(parentPath);
  } catch {
    return { ok: false };
  }
  if (!isPathInsideRoot(parentReal, srcRoot)) return { ok: false };

  const jsCandidate = join(dirname(parentPath), specifier);
  if (
    jsCandidate.includes(`${sep}node_modules${sep}`) ||
    jsCandidate.endsWith(`${sep}node_modules`)
  ) {
    return { ok: false };
  }

  try {
    lstatSync(jsCandidate);
    // Existing .js must win via nextResolve; if we are here after NOT_FOUND, do not remap.
    return { ok: false };
  } catch (error) {
    if (
      error === null ||
      typeof error !== 'object' ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    ) {
      return { ok: false };
    }
  }

  if (!jsCandidate.endsWith('.js')) return { ok: false };
  const tsCandidate = `${jsCandidate.slice(0, -3)}.ts`;

  let tsLstat;
  try {
    tsLstat = lstatSync(tsCandidate);
  } catch {
    return { ok: false };
  }
  // Allow symlinks; realpath + root check reject escape. Directories are never remapped.
  if (!tsLstat.isFile() && !tsLstat.isSymbolicLink()) return { ok: false };

  let tsReal;
  try {
    tsReal = realpathSync(tsCandidate);
  } catch {
    return { ok: false };
  }
  if (tsReal.includes(`${sep}node_modules${sep}`)) return { ok: false };
  if (!isPathInsideRoot(tsReal, srcRoot)) return { ok: false };

  let tsRealStat;
  try {
    tsRealStat = lstatSync(tsReal);
  } catch {
    return { ok: false };
  }
  if (!tsRealStat.isFile() || tsRealStat.isSymbolicLink()) return { ok: false };

  return { ok: true, url: pathToFileURL(tsReal).href };
};
