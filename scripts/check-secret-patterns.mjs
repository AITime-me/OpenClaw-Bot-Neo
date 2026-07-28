import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const excluded = new Set(['.git', 'node_modules', 'dist']);
const walk = (root) =>
  readdirSync(root).flatMap((name) => {
    if (excluded.has(name)) return [];
    const path = join(root, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
const tokenPatterns = [
  /\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/,
  /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----/,
  /https?:\/\/[^\s/@:]+:[^\s/@]+@/,
];
const failures = [];
for (const file of walk('.').filter((path) => !path.endsWith('package-lock.json'))) {
  const text = readFileSync(file, 'utf8');
  if (/^\s*OPENAI_API_KEY\s*=/m.test(text)) failures.push(`${file}: active OPENAI_API_KEY`);
  if (!file.includes('sensitive-data-scanner') && !file.includes('check-secret-patterns')) {
    for (const pattern of tokenPatterns)
      if (pattern.test(text)) failures.push(`${file}: token-like literal`);
  }
}
const financial = [
  'src/core/ports/billing-monitor.port.ts',
  'src/core/ports/subscription-registry.port.ts',
];
const forbidden =
  /\b(pay|payment|purchase|checkout|topUp|recharge|renewPaid|changePlan|subscribe|transferFunds|sendCard|authorizePayment)\s*\(/;
for (const file of financial)
  if (forbidden.test(readFileSync(file, 'utf8'))) failures.push(`${file}: payment method`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Secret and financial-pattern checks passed.');
