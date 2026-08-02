import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { productionFactoryModuleSpecifier } from '../scripts/integration/lib/lazy-production.ts';
import {
  analyzeIntegrationBoundaries,
  evaluateImport,
  extractImportSpecifiers,
  isForbiddenTarget,
  normalizeSpecifier,
  resolveRepoRelativeImport,
} from '../scripts/lib/integration-boundary-policy.mjs';

const REPO_ROOT = process.cwd();
const INTEGRATION_ROOT = join(REPO_ROOT, 'scripts', 'integration');
const VERIFY_SCRIPT = join(REPO_ROOT, 'scripts', 'verify-integration-boundaries.mjs');
const LAZY_PRODUCTION = join(INTEGRATION_ROOT, 'lib', 'lazy-production.ts');
const FACTORY_IMPORT = 'create-posix-durable-local-host';

const collectTsFiles = (directory: string): string[] => {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      files.push(...collectTsFiles(absolute));
      continue;
    }
    if (entry.endsWith('.ts')) files.push(absolute);
  }
  return files;
};

const stripImportTypeBlocks = (content: string): string =>
  content.replace(/import\s+type\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, '');

const hasRuntimeFactoryImport = (content: string): boolean => {
  const stripped = stripImportTypeBlocks(content);
  return (
    /\bimport\s*\(\s*['"][^'"]*create-posix-durable-local-host/.test(stripped) ||
    /\bfrom\s+['"][^'"]*create-posix-durable-local-host/.test(stripped)
  );
};

describe('integration boundary enforcement', () => {
  it('verify-integration-boundaries.mjs exits 0 on current tree', () => {
    const result = spawnSync(process.execPath, [VERIFY_SCRIPT], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Integration boundaries verified');
  });

  it('lazy-production is the only file with runtime factory import', () => {
    const offenders: string[] = [];
    for (const filePath of collectTsFiles(INTEGRATION_ROOT)) {
      const content = readFileSync(filePath, 'utf8');
      if (hasRuntimeFactoryImport(content) && filePath !== LAZY_PRODUCTION) {
        offenders.push(filePath);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('lazy-production exposes the canonical module specifier', () => {
    expect(productionFactoryModuleSpecifier()).toContain(
      'src/host/durable/create-posix-durable-local-host.ts',
    );
    expect(readFileSync(LAZY_PRODUCTION, 'utf8')).toContain(FACTORY_IMPORT);
  });

  it('harness-config does not import tests/support fixtures', () => {
    const content = readFileSync(join(INTEGRATION_ROOT, 'lib', 'harness-config.ts'), 'utf8');
    expect(content.includes('tests/support/fixtures')).toBe(false);
  });

  it('allows helper-to-helper relative imports within scripts/integration', () => {
    const violations = analyzeIntegrationBoundaries({
      rootDir: REPO_ROOT,
      filesContent: {
        'scripts/integration/lib/helper-a.ts': `import { x } from './helper-b.ts';`,
        'scripts/integration/lib/helper-b.ts': `export const x = 1;`,
      },
    });
    expect(violations).toEqual([]);
  });

  it('rejects relative imports that escape to non-allowlisted src paths', () => {
    const violations = analyzeIntegrationBoundaries({
      rootDir: REPO_ROOT,
      filesContent: {
        'scripts/integration/lib/evil.ts': `import { x } from '../../../src/core/domain/message.ts';`,
      },
    });
    expect(violations.some((v) => v.includes('non-allowlisted'))).toBe(true);
  });

  it('rejects non-literal dynamic imports', () => {
    const violations = analyzeIntegrationBoundaries({
      rootDir: REPO_ROOT,
      filesContent: {
        'scripts/integration/lib/evil.ts': `const m = 'src/host/durable/create-posix-durable-local-host.ts'; import(m);`,
      },
    });
    expect(violations.some((v) => v.includes('non-literal dynamic import'))).toBe(true);
  });

  it('rejects template literal dynamic imports', () => {
    const specifiers = extractImportSpecifiers('import(`./foo.ts`);');
    expect(specifiers.some((entry) => entry.kind === 'dynamic-non-literal')).toBe(true);
  });

  it('rejects specifiers with query or hash', () => {
    expect(normalizeSpecifier('./foo.ts?raw').ok).toBe(false);
    expect(normalizeSpecifier('./foo.ts#frag').ok).toBe(false);
  });

  it('rejects forbidden sqlite and process-lock targets even when relative', () => {
    expect(isForbiddenTarget('src/host/durable/sqlite-factory.ts')).toBe(true);
    expect(isForbiddenTarget('src/host/durable/process-lock.ts')).toBe(true);
    const violations = evaluateImport(
      'scripts/integration/lib/evil.ts',
      { kind: 'static', value: './process-lock.ts' },
      REPO_ROOT,
    );
    expect(violations.length).toBeGreaterThan(0);
  });

  it('allows exact factory loader in lazy-production only', () => {
    const violations = analyzeIntegrationBoundaries({
      rootDir: REPO_ROOT,
      filesContent: {
        'scripts/integration/lib/lazy-production.ts': `
          export const load = () => import('../../../src/host/durable/create-posix-durable-local-host.ts');
        `,
        'scripts/integration/durable-composition-linux-child.ts': `
          import type { CreatePosixDurableLocalHostInput } from '../../src/host/durable/create-posix-durable-local-host.ts';
          import { err } from '../../src/core/domain/result.ts';
        `,
      },
    });
    expect(violations).toEqual([]);
  });

  it('resolves relative imports to repo-relative posix paths', () => {
    const resolved = resolveRepoRelativeImport(
      'scripts/integration/lib/helper-a.ts',
      './child-gate.ts',
      REPO_ROOT,
    );
    expect(resolved).toBe('scripts/integration/lib/child-gate.ts');
  });

  it('current repository tree has no integration boundary violations', () => {
    const violations = analyzeIntegrationBoundaries({ rootDir: REPO_ROOT });
    expect(violations).toEqual([]);
  });
});
