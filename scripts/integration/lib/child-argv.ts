/**
 * Central production argv builder for Linux durable-composition TypeScript children.
 */
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute filesystem path to the registration bootstrap (integration-private). */
export const TS_SOURCE_RESOLVE_REGISTER_PATH = join(__dirname, 'ts-source-resolve-register.mjs');

/** file: URL for `--import` (required on Windows; portable on Linux). */
export const TS_SOURCE_RESOLVE_REGISTER_HREF = pathToFileURL(TS_SOURCE_RESOLVE_REGISTER_PATH).href;

/**
 * Production argv for strip-types child entrypoints that load project src via NodeNext `.js` specifiers.
 * Order is load-bearing: register before strip-types and before the `.ts` entry.
 */
export const buildLinuxGateChildArgv = (entryTsPath: string): readonly string[] => {
  if (typeof entryTsPath !== 'string' || entryTsPath.length === 0) {
    throw new Error('CHILD_ARGV_ENTRY_REQUIRED');
  }
  return ['--import', TS_SOURCE_RESOLVE_REGISTER_HREF, '--experimental-strip-types', entryTsPath];
};

/** True when argv matches the production resolver + strip-types + entry shape. */
export const isLinuxGateChildArgvWithResolver = (argv: readonly string[]): boolean => {
  if (argv.length < 4) return false;
  const importIdx = argv.indexOf('--import');
  const stripIdx = argv.indexOf('--experimental-strip-types');
  if (importIdx < 0 || stripIdx < 0) return false;
  if (importIdx >= stripIdx) return false;
  const registerSpec = argv[importIdx + 1];
  if (typeof registerSpec !== 'string') return false;
  const normalized = registerSpec.replace(/\\/g, '/');
  if (!normalized.includes('scripts/integration/lib/ts-source-resolve-register.mjs')) {
    return false;
  }
  if (!(normalized.startsWith('file:') || isAbsolute(registerSpec))) return false;
  const entry = argv[stripIdx + 1];
  return typeof entry === 'string' && entry.endsWith('.ts');
};
