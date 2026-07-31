import { describe, expect, it } from 'vitest';
import type { BoundaryReport } from '../scripts/lib/boundary-checker.mjs';
import { analyzeBoundaries, extractReferences } from '../scripts/lib/boundary-checker.mjs';

const fixture = (name: string): string => `tests/fixtures/boundaries/${name}`;
const codes = (report: BoundaryReport): readonly string[] =>
  report.violations.map((violation) => violation.code);

describe('reference extraction', () => {
  it('recognises static, export-from, dynamic and require references', () => {
    const references = extractReferences(
      [
        "import value from './a.js';",
        "export * from './b.js';",
        "export const load = () => import('./c.js');",
        "const legacy = require('./d.js');",
      ].join('\n'),
      'sample.ts',
    );
    expect([...references.map((reference) => reference.kind)].sort()).toEqual([
      'dynamic-import',
      'export-from',
      'import',
      'require',
    ]);
    expect(references.every((reference) => reference.line > 0)).toBe(true);
  });

  it('records computed import and require instead of dropping them', () => {
    const references = extractReferences(
      [
        'const target = "./x.js";',
        'export const a = () => import(target);',
        'export const b = () => require(target);',
        'export const c = () => import(`./${target}`);',
        'export const d = () => require("./" + target);',
      ].join('\n'),
      'computed.ts',
    );
    const kinds = references.map((reference) => reference.kind).sort();
    expect(kinds).toEqual([
      'computed-import',
      'computed-import',
      'computed-require',
      'computed-require',
    ]);
    expect(references.every((reference) => reference.computed === true)).toBe(true);
    expect(references.every((reference) => reference.specifier === '<computed>')).toBe(true);
  });
});

describe('allowlist-based layer rules', () => {
  it('accepts a compliant layered fixture', () => {
    const report = analyzeBoundaries({ rootDir: fixture('allowed') });
    expect(report.violations).toEqual([]);
    expect(report.filesAnalyzed).toBeGreaterThan(0);
  });

  it('accepts a compliant host composition fixture', () => {
    const report = analyzeBoundaries({
      rootDir: fixture('host-allowed'),
      requiredLayers: [],
    });
    expect(report.violations).toEqual([]);
    expect(report.filesAnalyzed).toBeGreaterThan(0);
  });

  it('accepts a compliant host config fixture', () => {
    const report = analyzeBoundaries({
      rootDir: fixture('host-config-allowed'),
      requiredLayers: [],
    });
    expect(report.violations).toEqual([]);
    expect(report.filesAnalyzed).toBeGreaterThan(0);
  });

  it('accepts a compliant host storage fixture', () => {
    const report = analyzeBoundaries({
      rootDir: fixture('host-storage-allowed'),
      requiredLayers: [],
    });
    expect(report.violations).toEqual([]);
    expect(report.filesAnalyzed).toBeGreaterThan(0);
  });

  it('accepts a compliant POSIX storage-root runtime adapter fixture', () => {
    const report = analyzeBoundaries({
      rootDir: fixture('host-storage-runtime-allowed'),
      requiredLayers: [],
    });
    expect(report.violations).toEqual([]);
    expect(report.filesAnalyzed).toBeGreaterThan(0);
  });

  it('accepts opener registration of the POSIX storage-root capability seal', () => {
    const report = analyzeBoundaries({
      rootDir: fixture('host-storage-capability-allowed'),
      requiredLayers: [],
    });
    expect(report.violations).toEqual([]);
    expect(report.filesAnalyzed).toBeGreaterThan(0);
  });

  it('accepts the dedicated better-sqlite3 driver wrapper fixture', () => {
    const report = analyzeBoundaries({
      rootDir: fixture('host-sqlite-driver-allowed'),
      requiredLayers: [],
    });
    expect(report.violations).toEqual([]);
    expect(report.filesAnalyzed).toBeGreaterThan(0);
  });

  it('accepts SQLite factory resolve-only capability facade fixture', () => {
    const report = analyzeBoundaries({
      rootDir: fixture('host-sqlite-resolve-allowed'),
      requiredLayers: [],
    });
    expect(report.violations).toEqual([]);
    expect(report.filesAnalyzed).toBeGreaterThan(0);
  });

  it.each([
    ['forbidden-static', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-export-from', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-dynamic', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-dynamic', 'DYNAMIC_IMPORT_FORBIDDEN'],
    ['forbidden-renamed', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-external', 'EXTERNAL_DEPENDENCY'],
    ['forbidden-internal', 'INTERNAL_MODULE_LEAK'],
    ['cycle', 'CYCLE'],
    ['forbidden-computed-import-id', 'COMPUTED_MODULE_SPECIFIER'],
    ['forbidden-computed-require-id', 'COMPUTED_MODULE_SPECIFIER'],
    ['forbidden-computed-import-template', 'COMPUTED_MODULE_SPECIFIER'],
    ['forbidden-computed-require-concat', 'COMPUTED_MODULE_SPECIFIER'],
    ['forbidden-computed-import-conditional', 'COMPUTED_MODULE_SPECIFIER'],
    ['forbidden-computed-import-property', 'COMPUTED_MODULE_SPECIFIER'],
    ['forbidden-computed-require-call', 'COMPUTED_MODULE_SPECIFIER'],
    ['forbidden-computed-import-manifest', 'COMPUTED_MODULE_SPECIFIER'],
    ['forbidden-computed-require-config', 'COMPUTED_MODULE_SPECIFIER'],
    ['forbidden-core-to-host', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-host-internal', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-host-to-tests', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-host-to-scripts', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-host-channel', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-host-sealer', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-core-config-to-host', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-host-config-internal', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-host-config-to-tests', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-host-config-to-scripts', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-host-config-channel', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-host-config-sealer', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-core-to-host-storage', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-host-storage-internal', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-host-storage-to-tests', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-host-storage-to-scripts', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-host-storage-channel', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-host-storage-fs', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-host-storage-http', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-host-storage-sealer', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-host-storage-npm', 'EXTERNAL_DEPENDENCY'],
    ['forbidden-host-storage-runtime-sqlite', 'EXTERNAL_DEPENDENCY'],
    ['forbidden-host-storage-runtime-http', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-host-storage-runtime-child-process', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-host-unrelated-fs', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-host-storage-capability-sealer', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-host-capability-unrelated', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-host-capability-in-memory', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-host-capability-channel', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-core-capability', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-host-capability-posix-system', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-host-sqlite-sealer', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-host-sqlite-non-driver-npm', 'EXTERNAL_DEPENDENCY'],
    ['forbidden-host-sqlite-factory-sealer', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-host-sqlite-factory-unrelated-internal', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-host-sqlite-other-resolve', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-host-sqlite-other-npm', 'EXTERNAL_DEPENDENCY'],
    ['forbidden-host-unrelated-resolve', 'INTERNAL_MODULE_LEAK'],
  ])('rejects the %s fixture with %s', (name, code) => {
    const report = analyzeBoundaries({ rootDir: fixture(name), requiredLayers: [] });
    expect(codes(report)).toContain(code);
  });

  it('names the offending file, line and reference kind', () => {
    const report = analyzeBoundaries({ rootDir: fixture('forbidden-dynamic'), requiredLayers: [] });
    const violation = report.violations.find(
      (candidate) => candidate.code === 'FORBIDDEN_DEPENDENCY',
    );
    expect(violation?.message).toContain('core/application/loader.ts');
    expect(violation?.message).toContain('dynamic-import');
  });

  it('reports computed module specifier without echoing runtime values', () => {
    const report = analyzeBoundaries({
      rootDir: fixture('forbidden-computed-import-manifest'),
      requiredLayers: [],
    });
    const violation = report.violations.find(
      (candidate) => candidate.code === 'COMPUTED_MODULE_SPECIFIER',
    );
    expect(violation?.message).toContain('computed-import');
    expect(violation?.message).not.toMatch(/secret|token|password/i);
  });
});

describe('fail-closed conditions', () => {
  it('reports a zero-file condition instead of a false green result', () => {
    const report = analyzeBoundaries({ rootDir: fixture('directory-that-does-not-exist') });
    expect(report.filesAnalyzed).toBe(0);
    expect(codes(report)).toContain('ZERO_FILES');
    expect(codes(report)).toContain('MISSING_LAYER');
  });

  it('reports a missing expected layer', () => {
    const report = analyzeBoundaries({
      rootDir: fixture('cycle'),
      requiredLayers: ['core/application'],
    });
    expect(codes(report)).toContain('MISSING_LAYER');
  });
});

describe('production source tree', () => {
  it('has no boundary violations', () => {
    const report = analyzeBoundaries({ rootDir: 'src' });
    expect(report.violations).toEqual([]);
    expect(report.filesAnalyzed).toBeGreaterThan(20);
  }, 30_000);
});

describe('package exports', () => {
  it('publishes only the documented root export', async () => {
    const { readFileSync } = await import('node:fs');
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      exports: Record<string, unknown>;
      files: string[];
    };
    expect(Object.keys(pkg.exports)).toEqual(['.']);
    expect(pkg.files).toEqual(['dist']);
    expect(JSON.stringify(pkg.exports)).not.toMatch(/\.internal|tests\//);
  });
});
