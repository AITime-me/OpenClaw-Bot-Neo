import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const walk = (root) =>
  readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
const failures = [];
for (const file of walk('src/core').filter((path) => path.endsWith('.ts'))) {
  const text = readFileSync(file, 'utf8');
  if (/from\s+['"][^'"]*(adapters|providers|integrations|monitors)/.test(text))
    failures.push(`${file}: forbidden implementation import`);
}
for (const file of walk('src/core/domain').filter((path) => path.endsWith('.ts'))) {
  const text = readFileSync(file, 'utf8');
  if (/\b(chat_id|file_id|parse_mode|inline_keyboard)\b/i.test(text))
    failures.push(`${file}: transport-specific domain type`);
}
for (const file of walk('skills').filter((path) => path.endsWith('.md'))) {
  const text = readFileSync(file, 'utf8');
  if (/\b(chat_id|file_id|parse_mode|inline_keyboard)\b/i.test(text))
    failures.push(`${file}: transport-specific skill term`);
}
const routing = readFileSync('src/core/routing/model-routing-policy.ts', 'utf8');
if (!routing.includes("return err({ code: 'NO_SAFE_MODEL'"))
  failures.push('routing: missing fail-closed unknown/unavailable behavior');
if (/api.?key/i.test(routing)) failures.push('routing: API-key fallback reference found');
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Boundary checks passed.');
