/**
 * `--import` bootstrap: register TypeScript source resolve hooks before child entry loads.
 * Reads only OPENCLAW_B3C4_REPOSITORY_ROOT (already validated by parent child-gate wiring).
 */
import { register } from 'node:module';
import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

const REPOSITORY_ROOT_ENV = 'OPENCLAW_B3C4_REPOSITORY_ROOT';

const rawRoot = process.env[REPOSITORY_ROOT_ENV];
if (typeof rawRoot !== 'string' || rawRoot.length === 0) {
  throw new Error('TS_SOURCE_RESOLVE_ROOT_MISSING');
}
if (!isAbsolute(rawRoot)) {
  throw new Error('TS_SOURCE_RESOLVE_ROOT_NOT_ABSOLUTE');
}

let workspaceRoot;
try {
  workspaceRoot = realpathSync(rawRoot);
} catch {
  throw new Error('TS_SOURCE_RESOLVE_ROOT_REALPATH_FAILED');
}

const workspaceStat = statSync(workspaceRoot);
if (!workspaceStat.isDirectory()) {
  throw new Error('TS_SOURCE_RESOLVE_ROOT_NOT_DIRECTORY');
}

const srcCandidate = join(workspaceRoot, 'src');
let srcRoot;
try {
  srcRoot = realpathSync(srcCandidate);
} catch {
  throw new Error('TS_SOURCE_RESOLVE_SRC_REALPATH_FAILED');
}

const srcStat = statSync(srcRoot);
if (!srcStat.isDirectory()) {
  throw new Error('TS_SOURCE_RESOLVE_SRC_NOT_DIRECTORY');
}

register('./ts-source-resolve-hook.mjs', import.meta.url, {
  data: {
    workspaceRoot,
    srcRoot,
  },
});
