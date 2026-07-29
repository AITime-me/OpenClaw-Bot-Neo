/**
 * Quality-gate runner for local/review tooling.
 *
 * This is a non-production review check. On unsupported Node it enables
 * OPENCLAW_REVIEW_NODE_OVERRIDE=1 unless OPENCLAW_PRODUCTION_NODE_GATE=1 is set.
 * Production gate always forbids override and fails outside >=22.13.0 <23.
 */

import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import { pathToFileURL } from 'node:url';

const REVIEW_FLAG = 'OPENCLAW_REVIEW_NODE_OVERRIDE';
const PRODUCTION_FLAG = 'OPENCLAW_PRODUCTION_NODE_GATE';

const steps = Object.freeze([
  'check:node',
  'typecheck',
  'lint',
  'format:check',
  'test:run',
  'check:boundaries',
  'check:secrets',
  'check:hygiene',
]);

export const npmExecutableFor = (platform = process.platform) =>
  platform === 'win32' ? 'npm.cmd' : 'npm';

export const buildCheckEnvironment = (environment = process.env) => {
  const copy = { ...environment };
  if (copy[PRODUCTION_FLAG] === '1') copy[REVIEW_FLAG] = '';
  else copy[REVIEW_FLAG] = '1';
  return copy;
};

/**
 * Accepts only the npm CLI installed under the actual Node executable root. Both paths are
 * resolved before comparison, so traversal and symlink escapes fail closed.
 */
export const validateNpmCliPath = ({
  candidate,
  nodeExecutable = process.execPath,
  npmNodeExecutable,
  platform = process.platform,
  realpath = (path) => realpathSync.native(path),
} = {}) => {
  const pathApi = platform === 'win32' ? win32 : posix;
  if (
    typeof candidate !== 'string' ||
    typeof nodeExecutable !== 'string' ||
    !pathApi.isAbsolute(candidate) ||
    !pathApi.isAbsolute(nodeExecutable)
  )
    return null;
  if (
    pathApi.normalize(candidate) !== candidate ||
    pathApi.normalize(nodeExecutable) !== nodeExecutable
  )
    return null;
  const cliBasename = pathApi.basename(candidate);
  if (cliBasename !== 'npm-cli.js' && cliBasename !== 'npm-cli.cjs') return null;
  try {
    const realNode = realpath(nodeExecutable);
    if (
      typeof npmNodeExecutable === 'string' &&
      (!pathApi.isAbsolute(npmNodeExecutable) ||
        realpath(npmNodeExecutable).toLowerCase() !== realNode.toLowerCase())
    )
      return null;
    const nodeRoot = pathApi.dirname(realNode);
    const realCandidate = realpath(candidate);
    const expected = pathApi.join(nodeRoot, 'node_modules', 'npm', 'bin', cliBasename);
    const normalizeForComparison = (path) =>
      platform === 'win32' ? pathApi.normalize(path).toLowerCase() : pathApi.normalize(path);
    if (normalizeForComparison(realCandidate) !== normalizeForComparison(expected)) return null;
    const withinRoot = pathApi.relative(nodeRoot, realCandidate);
    if (
      withinRoot.length === 0 ||
      withinRoot === '..' ||
      withinRoot.startsWith(`..${pathApi.sep}`) ||
      pathApi.isAbsolute(withinRoot)
    )
      return null;
    return realCandidate;
  } catch {
    return null;
  }
};

export const runCheckSteps = ({
  platform = process.platform,
  environment = process.env,
  spawn = spawnSync,
  nodeExecutable = process.execPath,
  validateCliPath = validateNpmCliPath,
} = {}) => {
  const executable = npmExecutableFor(platform);
  const childEnvironment = buildCheckEnvironment(environment);
  let npmCliPath = null;
  let useNodeFallback = false;
  for (const script of steps) {
    const args = ['run', script];
    const spawnOptions = {
      stdio: 'inherit',
      shell: false,
      env: childEnvironment,
    };
    let result = useNodeFallback
      ? spawn(nodeExecutable, [npmCliPath, ...args], spawnOptions)
      : spawn(executable, args, spawnOptions);
    if (result.error?.code === 'EINVAL' && platform === 'win32') {
      npmCliPath = validateCliPath({
        candidate: childEnvironment.npm_execpath,
        nodeExecutable,
        npmNodeExecutable: childEnvironment.npm_node_execpath,
        platform,
      });
      if (npmCliPath === null) {
        console.error('[check] Refused untrusted npm CLI fallback path.');
        return 1;
      }
      useNodeFallback = true;
      result = spawn(nodeExecutable, [npmCliPath, ...args], spawnOptions);
    }
    if (result.error !== undefined) {
      console.error(`[check] Failed to spawn ${executable}: ${result.error.name}.`);
      return 1;
    }
    if (result.signal !== null) {
      console.error(`[check] ${script} terminated by signal ${result.signal}.`);
      return 1;
    }
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
};

const isCli =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isCli) {
  if (process.env[PRODUCTION_FLAG] === '1') {
    console.warn(
      `[check] ${PRODUCTION_FLAG}=1 — strict production Node gate; review override disabled.`,
    );
  } else {
    console.warn(
      `[check] Non-production review/tooling run: ${REVIEW_FLAG}=1. ` +
        `This does NOT mark production Node compatibility as PASS. ` +
        `Set ${PRODUCTION_FLAG}=1 for strict production Node.`,
    );
  }
  process.exit(runCheckSteps());
}
