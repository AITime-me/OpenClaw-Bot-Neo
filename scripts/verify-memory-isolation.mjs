import { readFileSync } from 'node:fs';
const policy = readFileSync('src/core/policy/namespace-isolation.ts', 'utf8');
const pipeline = readFileSync('src/core/pipelines/memory-write.pipeline.md', 'utf8');
const scannerIndex = pipeline.indexOf('run SensitiveDataScanner');
const writeIndex = pipeline.indexOf('write through MemoryPort');
const failures = [];
if (!policy.includes('active === null')) failures.push('namespace missing default deny');
if (!policy.includes('security-restricted')) failures.push('security-restricted isolation missing');
if (scannerIndex < 0 || writeIndex < 0 || scannerIndex >= writeIndex)
  failures.push('scanner must precede MemoryPort');
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Memory isolation checks passed.');
