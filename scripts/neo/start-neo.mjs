import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchNeoProcess } from './launch-neo-process.mjs';

const launcherDir = dirname(fileURLToPath(import.meta.url));
const runNeoProcessModule = join(launcherDir, '../../dist/neo-runtime/cli/run-neo-process.js');

const result = await launchNeoProcess({
  importRunNeoProcess: () => import(pathToFileURL(runNeoProcessModule).href),
});
process.exitCode = result.exitCode;
