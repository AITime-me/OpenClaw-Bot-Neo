/**
 * Node strip-types launcher for the Linux durable composition gate.
 * Dynamic-imports the TypeScript entry so relative `.ts` specifiers resolve at runtime.
 */
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const entry = join(dirname(fileURLToPath(import.meta.url)), 'durable-composition-linux-gate.ts');
const mod = await import(pathToFileURL(entry).href);
if (typeof mod.runLinuxCompositionGate === 'function') {
  const code = await mod.runLinuxCompositionGate();
  process.exitCode = typeof code === 'number' ? code : 1;
} else {
  process.stderr.write('Linux composition gate entry is missing runLinuxCompositionGate export.\n');
  process.exitCode = 1;
}
