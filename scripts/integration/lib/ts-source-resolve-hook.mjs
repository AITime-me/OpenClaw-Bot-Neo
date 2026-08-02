/**
 * Async customization hooks for TypeScript source `.js` → `.ts` fallback.
 * Runs on the Node module loader thread. Configuration arrives only via `initialize` data.
 */
import { tryResolveTsSourceFallback } from './ts-source-resolve-policy.mjs';

/** @type {{ srcRoot: string } | null} */
let config = null;

/**
 * @param {{ srcRoot?: string, workspaceRoot?: string }} data
 */
export async function initialize(data) {
  if (data === null || typeof data !== 'object') {
    throw new Error('TS_SOURCE_RESOLVE_HOOK_CONFIG_INVALID');
  }
  const srcRoot = data.srcRoot;
  if (typeof srcRoot !== 'string' || srcRoot.length === 0) {
    throw new Error('TS_SOURCE_RESOLVE_HOOK_SRC_ROOT_INVALID');
  }
  config = { srcRoot };
}

/**
 * @param {string} specifier
 * @param {{ parentURL?: string | URL }} context
 * @param {(specifier: string, context: object) => Promise<object>} nextResolve
 */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (
      error === null ||
      typeof error !== 'object' ||
      !('code' in error) ||
      error.code !== 'ERR_MODULE_NOT_FOUND'
    ) {
      throw error;
    }
    if (config === null) {
      throw error;
    }
    const fallback = tryResolveTsSourceFallback({
      specifier,
      parentURL: context.parentURL,
      srcRoot: config.srcRoot,
    });
    if (!fallback.ok) {
      throw error;
    }
    return {
      shortCircuit: true,
      url: fallback.url,
    };
  }
}
