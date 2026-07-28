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

/** Detect transferable Symbol-brand trust markers in security evidence modules. */
const evidenceFiles = listFiles('src/core/domain').filter((path) => path.endsWith('.internal.ts'));
const symbolBrand =
  /(?:Brand\s*=\s*Symbol\b|Symbol\s*\(\s*['"`][^'"`]*[Bb]rand|\[\s*[A-Za-z0-9_]*[Bb]rand\s*\]\s*:)/;
for (const file of evidenceFiles) {
  const source = readFileSync(file, 'utf8');
  if (symbolBrand.test(source))
    failures.push(`SYMBOL_TRUST_BRAND: ${file} still uses a Symbol property as security proof.`);
}

const packageJsonPath = 'package.json';
if (!existsSync(packageJsonPath)) failures.push('PACKAGE_EXPORTS: package.json is missing.');
else {
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const exportKeys = Object.keys(pkg.exports ?? {});
  if (exportKeys.length !== 1 || exportKeys[0] !== '.')
    failures.push('PACKAGE_EXPORTS: only the documented root "." export is allowed.');
  const serialized = JSON.stringify(pkg.exports ?? {});
  if (serialized.includes('.internal') || serialized.includes('tests/'))
    failures.push('PACKAGE_EXPORTS: internal or test subpaths must not be exported.');
  if (!Array.isArray(pkg.files) || !pkg.files.includes('dist') || pkg.files.includes('src'))
    failures.push('PACKAGE_EXPORTS: package files allowlist must publish dist only.');
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`Boundary checks passed for ${String(report.filesAnalyzed)} source files.`);
