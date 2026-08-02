import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const launcherDir = dirname(fileURLToPath(import.meta.url));
const readNeoStatusModule = join(launcherDir, '../../dist/neo-runtime/cli/read-neo-status.js');

const { readNeoStatusFromNode } = await import(pathToFileURL(readNeoStatusModule).href);

const result = await readNeoStatusFromNode();
process.exitCode = result.exitCode;
