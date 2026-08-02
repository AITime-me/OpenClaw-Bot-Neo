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
  process.exit(result.status ?? 1);
}

const entry = join(dirname(fileURLToPath(import.meta.url)), 'neo-runtime-linux-gate.ts');
const mod = await import(pathToFileURL(entry).href);
if (typeof mod.runNeoRuntimeLinuxGate === 'function') {
  const code = await mod.runNeoRuntimeLinuxGate();
  process.exitCode = typeof code === 'number' ? code : 1;
} else {
  process.stderr.write('Neo runtime Linux gate entry is missing runNeoRuntimeLinuxGate export.\n');
  process.exitCode = 1;
}
