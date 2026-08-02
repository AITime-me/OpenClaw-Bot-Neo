/**
 * Integration boundary policy for scripts/integration.
 * Shared by verify-integration-boundaries.mjs and unit tests.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const FACTORY_IMPORT = 'create-posix-durable-local-host';

const FORBIDDEN_PATH_FRAGMENTS = [
  '/tests/',
  'process-lock',
  'posix-storage',
  'create-node-posix',
  'sqlite',
  'better-sqlite',
  'fs-ext',
];

const ALLOWED_SRC_IMPORTS = new Map([
  [
    'scripts/integration/lib/lazy-production.ts',
    new Set(['src/host/durable/create-posix-durable-local-host.ts']),
  ],
  [
    'scripts/integration/durable-composition-linux-child.ts',
    new Set([
      'src/host/durable/create-posix-durable-local-host.ts',
      'src/host/durable/posix-durable-local-host-composition-diagnostics.ts',
      'src/core/domain/result.ts',
    ]),
  ],
  [
    'scripts/integration/lib/harness-config.ts',
    new Set([
      'src/host/durable/create-posix-durable-local-host.ts',
      'src/host/in-memory/memory-policy.ts',
      'src/core/domain/index.ts',
      'src/core/domain/memory-access.internal.ts',
    ]),
  ],
  [
    'scripts/integration/lib/neo-runtime-evidence.ts',
    new Set(['src/neo-runtime/logging/neo-runtime-child-observability.ts']),
  ],
]);

export const toPosixPath = (value) => value.replace(/\\/g, '/');

export const normalizeSpecifier = (specifier) => {
  if (specifier.includes('?') || specifier.includes('#')) {
    return { ok: false, reason: 'QUERY_OR_HASH' };
  }
  return { ok: true, value: toPosixPath(specifier) };
};

export const isForbiddenTarget = (normalizedPath) =>
  FORBIDDEN_PATH_FRAGMENTS.some((fragment) => normalizedPath.includes(fragment));

export const resolveRepoRelativeImport = (importerRelPath, specifier, rootDir) => {
  const importerDir = dirname(join(rootDir, importerRelPath));
  const absolute = resolve(importerDir, specifier);
  const repoRelative = toPosixPath(relative(rootDir, absolute));
  return repoRelative;
};

export const stripImportTypeBlocks = (content) =>
  content.replace(/import\s+type\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '');

export const extractImportSpecifiers = (content) => {
  const specifiers = [];
  const staticImport = /\bfrom\s+['"]([^'"]+)['"]/g;
  const dynamicLiteral = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  const dynamicNonLiteral = /\bimport\s*\(\s*(?!['"])/g;
  let match;
  while ((match = staticImport.exec(content)) !== null)
    specifiers.push({ kind: 'static', value: match[1] });
  while ((match = dynamicLiteral.exec(content)) !== null) {
    specifiers.push({ kind: 'dynamic-literal', value: match[1] });
  }
  while ((match = dynamicNonLiteral.exec(content)) !== null) {
    specifiers.push({ kind: 'dynamic-non-literal', value: match[0] });
  }
  return specifiers;
};

export const hasRuntimeFactoryImport = (content) => {
  const stripped = stripImportTypeBlocks(content);
  return (
    /\bimport\s*\(\s*['"][^'"]*create-posix-durable-local-host/.test(stripped) ||
    /\bfrom\s+['"][^'"]*create-posix-durable-local-host/.test(stripped)
  );
};

const normalizeSrcPath = (specifier) => {
  const match = specifier.match(/(?:^|\/)src\/(.+\.ts)$/);
  return match ? `src/${match[1]}` : null;
};

const integrationPrefix = 'scripts/integration/';

export const evaluateImport = (importerRelPath, specifierEntry, rootDir) => {
  const violations = [];
  if (specifierEntry.kind === 'dynamic-non-literal') {
    violations.push(`${importerRelPath}: non-literal dynamic import is forbidden`);
    return violations;
  }

  const normalized = normalizeSpecifier(specifierEntry.value);
  if (!normalized.ok) {
    violations.push(
      `${importerRelPath}: import specifier contains query or hash: "${specifierEntry.value}"`,
    );
    return violations;
  }

  const specifier = normalized.value;
  if (isForbiddenTarget(specifier)) {
    violations.push(`${importerRelPath}: forbidden import target "${specifier}"`);
    return violations;
  }

  if (specifier.startsWith('.')) {
    const resolved = resolveRepoRelativeImport(importerRelPath, specifier, rootDir);
    if (isForbiddenTarget(resolved)) {
      violations.push(`${importerRelPath}: forbidden relative import resolves to "${resolved}"`);
      return violations;
    }
    if (resolved.startsWith(integrationPrefix)) {
      return violations;
    }
    const allowedForFile = ALLOWED_SRC_IMPORTS.get(importerRelPath) ?? new Set();
    if (!allowedForFile.has(resolved)) {
      violations.push(
        `${importerRelPath}: relative import "${specifier}" resolves to non-allowlisted "${resolved}"`,
      );
    }
    return violations;
  }

  const srcPath = normalizeSrcPath(specifier);
  if (srcPath !== null) {
    const allowedForFile = ALLOWED_SRC_IMPORTS.get(importerRelPath) ?? new Set();
    if (!allowedForFile.has(srcPath)) {
      violations.push(
        `${importerRelPath}: src import "${srcPath}" is not allowlisted for this file`,
      );
    }
    return violations;
  }

  if (specifier.includes('src/')) {
    violations.push(`${importerRelPath}: non-allowlisted src import "${specifier}"`);
  }
  return violations;
};

export const analyzeFileContent = (importerRelPath, content, rootDir) => {
  const violations = [];
  const lazyProductionPath = join(rootDir, 'scripts', 'integration', 'lib', 'lazy-production.ts');
  const importerAbs = join(rootDir, importerRelPath);

  if (hasRuntimeFactoryImport(content) && importerAbs !== lazyProductionPath) {
    violations.push(
      `${importerRelPath}: forbidden runtime factory import (only lazy-production.ts may import factory)`,
    );
  }

  for (const specifierEntry of extractImportSpecifiers(content)) {
    violations.push(...evaluateImport(importerRelPath, specifierEntry, rootDir));
  }
  return violations;
};

export const collectTsFiles = (directory) => {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const absolute = join(directory, entry);
    const stats = statSync(absolute);
    if (stats.isDirectory()) {
      files.push(...collectTsFiles(absolute));
      continue;
    }
    if (entry.endsWith('.ts')) files.push(absolute);
  }
  return files;
};

/** Exact allowlisted harness `.mjs` modules under scripts/integration (not a global .mjs permit). */
export const HARNESS_MJS_ALLOWLIST = Object.freeze([
  'scripts/integration/lib/ts-source-resolve-register.mjs',
  'scripts/integration/lib/ts-source-resolve-hook.mjs',
  'scripts/integration/lib/ts-source-resolve-policy.mjs',
]);

const FORBIDDEN_MJS_IMPORT_FRAGMENTS = [
  'node:net',
  'node:http',
  'node:https',
  'node:dns',
  'node:dgram',
  'undici',
  'child_process',
];

/**
 * @param {string} importerRelPath
 * @param {string} content
 * @param {string} rootDir
 */
export const analyzeHarnessMjsContent = (importerRelPath, content, rootDir) => {
  const violations = [];
  if (!HARNESS_MJS_ALLOWLIST.includes(importerRelPath)) {
    violations.push(`${importerRelPath}: harness .mjs is not allowlisted`);
    return violations;
  }
  for (const fragment of FORBIDDEN_MJS_IMPORT_FRAGMENTS) {
    if (content.includes(fragment)) {
      violations.push(`${importerRelPath}: forbidden import fragment "${fragment}"`);
    }
  }
  if (hasRuntimeFactoryImport(content)) {
    violations.push(`${importerRelPath}: forbidden runtime factory import`);
  }
  for (const specifierEntry of extractImportSpecifiers(content)) {
    if (specifierEntry.kind === 'dynamic-non-literal') {
      violations.push(`${importerRelPath}: non-literal dynamic import is forbidden`);
      continue;
    }
    const specifier = specifierEntry.value;
    if (specifier.includes('src/') || /(?:^|\/)src\//.test(specifier)) {
      violations.push(`${importerRelPath}: must not import production src ("${specifier}")`);
    }
    if (specifier.startsWith('.') && !specifier.endsWith('.mjs')) {
      const resolved = resolveRepoRelativeImport(importerRelPath, specifier, rootDir);
      if (resolved.startsWith('src/')) {
        violations.push(`${importerRelPath}: relative import resolves into src ("${resolved}")`);
      }
    }
  }
  return violations;
};

/**
 * Analyze integration boundary policy for a file tree or injected fixture content.
 * @param {{ rootDir: string, filesContent?: Record<string, string> }} options
 */
export const analyzeIntegrationBoundaries = ({ rootDir, filesContent }) => {
  const violations = [];
  const lazyProductionRel = 'scripts/integration/lib/lazy-production.ts';

  if (filesContent !== undefined) {
    for (const [relPath, content] of Object.entries(filesContent)) {
      if (relPath.endsWith('.mjs')) {
        violations.push(...analyzeHarnessMjsContent(relPath, content, rootDir));
        continue;
      }
      violations.push(...analyzeFileContent(relPath, content, rootDir));
    }
    const lazyContent = filesContent[lazyProductionRel];
    if (lazyContent !== undefined && !lazyContent.includes(FACTORY_IMPORT)) {
      violations.push('lazy-production.ts must contain the factory import string');
    }
    return violations;
  }

  const integrationRoot = join(rootDir, 'scripts', 'integration');
  for (const filePath of collectTsFiles(integrationRoot)) {
    const rel = toPosixPath(relative(rootDir, filePath));
    const content = readFileSync(filePath, 'utf8');
    violations.push(...analyzeFileContent(rel, content, rootDir));
  }

  for (const rel of HARNESS_MJS_ALLOWLIST) {
    const absolute = join(rootDir, rel);
    let content;
    try {
      content = readFileSync(absolute, 'utf8');
    } catch {
      violations.push(`${rel}: allowlisted harness .mjs is missing`);
      continue;
    }
    violations.push(...analyzeHarnessMjsContent(rel, content, rootDir));
  }

  const lazyProduction = join(rootDir, lazyProductionRel);
  if (!readFileSync(lazyProduction, 'utf8').includes(FACTORY_IMPORT)) {
    violations.push('lazy-production.ts must contain the factory import string');
  }

  return violations;
};
