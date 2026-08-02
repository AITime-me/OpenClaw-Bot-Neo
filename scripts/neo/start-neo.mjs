import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const launcherDir = dirname(fileURLToPath(import.meta.url));
const runNeoProcessModule = join(launcherDir, '../../dist/neo-runtime/cli/run-neo-process.js');

const { runNeoProcessFromNode } = await import(pathToFileURL(runNeoProcessModule).href);

const result = await runNeoProcessFromNode();
process.exitCode = result.exitCode;
