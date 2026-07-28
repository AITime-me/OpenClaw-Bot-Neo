import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeBoundaries } from './lib/boundary-checker.mjs';

const failures = [];
const report = analyzeBoundaries({ rootDir: 'src' });
for (const violation of report.violations) failures.push(`${violation.code}: ${violation.message}`);
if (report.filesAnalyzed === 0) failures.push('ZERO_FILES: src produced no analysable files.');

const listFiles = (root) => {
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
};

const transportTerms = /\b(chat_id|file_id|parse_mode|inline_keyboard)\b/i;
const domainFiles = listFiles('src/core/domain').filter((path) => path.endsWith('.ts'));
const skillFiles = listFiles('skills').filter((path) => path.endsWith('.md'));
if (domainFiles.length === 0) failures.push('ZERO_FILES: src/core/domain has no files.');
if (skillFiles.length === 0) failures.push('ZERO_FILES: skills has no documents.');
for (const file of [...domainFiles, ...skillFiles])
  if (transportTerms.test(readFileSync(file, 'utf8')))
    failures.push(`TRANSPORT_TERM: ${file} contains a channel-specific term.`);

const routingPath = 'src/core/routing/model-routing-policy.ts';
if (!existsSync(routingPath)) failures.push(`ZERO_FILES: ${routingPath} is missing.`);
else {
  const routing = readFileSync(routingPath, 'utf8');
  if (!routing.includes("code: 'NO_SAFE_MODEL'"))
    failures.push('ROUTING: missing fail-closed behaviour for unavailable models.');
  if (/api.?key/i.test(routing)) failures.push('ROUTING: API-key fallback reference found.');
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`Boundary checks passed for ${String(report.filesAnalyzed)} source files.`);
