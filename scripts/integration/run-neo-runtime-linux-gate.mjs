/**
 * Node strip-types launcher for the Neo runtime Linux gate.
 * Relaunches with --experimental-strip-types when required so plain `node` invocation works.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const STRIP_TYPES_FLAG = '--experimental-strip-types';

if (!process.execArgv.includes(STRIP_TYPES_FLAG)) {
  const result = spawnSync(process.execPath, [STRIP_TYPES_FLAG, ...process.argv.slice(1)], {
    stdio: 'inherit',
    shell: false,
  });
  process.exit(result.status ?? 50);
}

const { bootstrapNeoRuntimeLinuxGate } = await import('./lib/neo-runtime-linux-gate-bootstrap.ts');
const entry = join(dirname(fileURLToPath(import.meta.url)), 'neo-runtime-linux-gate.ts');
process.exitCode = await bootstrapNeoRuntimeLinuxGate(() => import(pathToFileURL(entry).href));
