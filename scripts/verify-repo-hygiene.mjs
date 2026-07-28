import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** Repository hygiene gates: valid JSON, resolvable internal links and no hidden lifecycle scripts. */

const skipped = new Set(['.git', 'node_modules', 'dist', 'coverage']);
const walk = (root) =>
  readdirSync(root).flatMap((name) => {
    if (skipped.has(name)) return [];
    const path = join(root, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

const failures = [];
const files = walk('.');

const jsonFiles = files.filter((path) => path.endsWith('.json'));
if (jsonFiles.length === 0) failures.push('ZERO_FILES: no JSON configuration files found.');
for (const file of jsonFiles) {
  try {
    JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    failures.push(`INVALID_JSON: ${file} is not parseable.`);
  }
}

const forbiddenLifecycle = [
  'preinstall',
  'install',
  'postinstall',
  'prepare',
  'prepublish',
  'prepublishOnly',
  'prepack',
  'postpack',
];
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
for (const name of forbiddenLifecycle)
  if (Object.hasOwn(manifest.scripts ?? {}, name))
    failures.push(`LIFECYCLE_SCRIPT: package.json defines "${name}".`);

const markdownFiles = files.filter((path) => path.endsWith('.md'));
if (markdownFiles.length === 0) failures.push('ZERO_FILES: no Markdown documents found.');
const linkPattern = /\[[^\]]*\]\(([^)\s]+)\)/g;
for (const file of markdownFiles) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(linkPattern)) {
    const target = match[1];
    if (/^(?:https?:|mailto:|#)/.test(target)) continue;
    const [path] = target.split('#');
    if (path === undefined || path.length === 0) continue;
    if (!existsSync(resolve(dirname(file), path)))
      failures.push(`BROKEN_LINK: ${file} points at missing ${path}.`);
  }
}

const envExample = readFileSync('.env.example', 'utf8');
if (/^\s*OPENAI_API_KEY\s*=/m.test(envExample))
  failures.push('ENV: OPENAI_API_KEY must stay commented out in .env.example.');
if (!envExample.includes('OPENAI_API_KEY'))
  failures.push('ENV: .env.example must document that OPENAI_API_KEY is forbidden.');

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(
  `Repository hygiene checks passed (${String(jsonFiles.length)} JSON, ${String(markdownFiles.length)} Markdown files).`,
);
