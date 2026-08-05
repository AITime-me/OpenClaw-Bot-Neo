import { describe, expect, it } from 'vitest';
import type { BoundaryReport } from '../scripts/lib/boundary-checker.mjs';
import {
  analyzeBoundaries,
  extractReferences,
  POSIX_DURABLE_COMPOSITION_FACTORY_PATH,
  toPosix,
} from '../scripts/lib/boundary-checker.mjs';

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
    const report = analyzeBoundaries({ rootDir: fixture('allowed'), requiredLayers: [] });
    expect(report.violations).toEqual([]);
    expect(report.filesAnalyzed).toBeGreaterThan(0);
  });

  it('accepts a compliant communication layered fixture', () => {
    const report = analyzeBoundaries({
      rootDir: fixture('communication-allowed'),
      requiredLayers: [],
    });
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

  it('accepts SQLite factory lease-only capability facade fixture', () => {
    const report = analyzeBoundaries({
      rootDir: fixture('host-sqlite-lease-allowed'),
      requiredLayers: [],
    });
    expect(report.violations).toEqual([]);
    expect(report.filesAnalyzed).toBeGreaterThan(0);
  });

  it('accepts the dedicated process-lock driver wrapper fixture', () => {
    const report = analyzeBoundaries({
      rootDir: fixture('host-process-lock-driver-allowed'),
      requiredLayers: [],
    });
    expect(report.violations).toEqual([]);
    expect(report.filesAnalyzed).toBeGreaterThan(0);
  });

  it('accepts process-lock factory lease-only capability facade fixture', () => {
    const report = analyzeBoundaries({
      rootDir: fixture('host-process-lock-lease-allowed'),
      requiredLayers: [],
    });
    expect(report.violations).toEqual([]);
    expect(report.filesAnalyzed).toBeGreaterThan(0);
  });

  it('accepts exact POSIX durable composition process-lock importer fixture', () => {
    const report = analyzeBoundaries({
      rootDir: fixture('host-durable-process-lock-allowed'),
      requiredLayers: [],
    });
    expect(report.violations).toEqual([]);
    expect(report.filesAnalyzed).toBeGreaterThan(0);
  });

  it.each([
    'host-durable-dynamic-import-root-allowed',
    'host-durable-dynamic-import-lock-allowed',
    'host-durable-dynamic-import-sqlite-allowed',
  ])('accepts approved composition dynamic import fixture %s', (name) => {
    const report = analyzeBoundaries({ rootDir: fixture(name), requiredLayers: [] });
    expect(report.violations).toEqual([]);
    expect(report.filesAnalyzed).toBeGreaterThan(0);
  });

  it('normalizes Windows-style separators via toPosix before composition allowlist checks', () => {
    expect(toPosix('host\\durable\\create-posix-durable-local-host.ts')).toBe(
      POSIX_DURABLE_COMPOSITION_FACTORY_PATH,
    );
    expect(POSIX_DURABLE_COMPOSITION_FACTORY_PATH).not.toContain('\\');
  });

  it.each([
    ['forbidden-host-durable-dynamic-import-arbitrary', 'DYNAMIC_IMPORT_TARGET_FORBIDDEN'],
    ['forbidden-host-durable-dynamic-import-external', 'EXTERNAL_DEPENDENCY'],
    ['forbidden-host-durable-similar-importer', 'DYNAMIC_IMPORT_FORBIDDEN'],
    ['forbidden-host-durable-sibling-dynamic-import', 'DYNAMIC_IMPORT_FORBIDDEN'],
  ])('rejects composition dynamic import fixture %s with %s', (name, code) => {
    const report = analyzeBoundaries({ rootDir: fixture(name), requiredLayers: [] });
    expect(codes(report)).toContain(code);
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
    ['forbidden-host-sqlite-sanitized-internal', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-host-in-memory-sanitized-internal', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-host-sqlite-clearance-issuer', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-host-in-memory-secret-reader', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-host-sqlite-non-driver-npm', 'EXTERNAL_DEPENDENCY'],
    ['forbidden-host-sqlite-factory-sealer', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-host-sqlite-factory-unrelated-internal', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-host-sqlite-other-resolve', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-host-sqlite-other-npm', 'EXTERNAL_DEPENDENCY'],
    ['forbidden-host-unrelated-resolve', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-host-sqlite-other-lease', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-host-sqlite-driver-lease', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-host-unrelated-lease', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-host-in-memory-lease', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-core-lease', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-host-lease-channel', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-host-process-lock-other-npm', 'EXTERNAL_DEPENDENCY'],
    ['forbidden-host-process-lock-other-lease', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-host-sqlite-process-lock', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-host-runtime-process-lock-driver', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-host-process-lock-sealer', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-host-unrelated-process-lock-lease', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-host-in-memory-process-lock', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-host-durable-sibling-process-lock', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-core-durable-process-lock', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-channel-durable-process-lock', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-infra-domain-imports-connector', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-orchestrator-imports-infrastructure', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-core-telegram-sdk', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-communication-imports-connector', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-communication-imports-infrastructure', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-communication-barrel-via-domain-index', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-communication-barrel-via-ports-index', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-host-imports-telegram-adapter', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-communication-principal-internal', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-communication-persistence-sibling-host', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-communication-persistence-runtime', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-communication-persistence-adapter', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-communication-offline-factory-sibling-host', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-communication-offline-factory-runtime', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-communication-offline-factory-adapter', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-communication-persistence-barrel', 'PERSISTENCE_FACADE_BARREL_REEXPORT'],
    ['forbidden-communication-original-internal-direct', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-communication-text-delivery-internal', 'INTERNAL_MODULE_LEAK'],
    ['forbidden-communication-persistence-extra-export', 'PERSISTENCE_FACADE_EXTRA_EXPORT'],
    ['forbidden-communication-persistence-export-star', 'PERSISTENCE_FACADE_EXPORT_STAR'],
    ['forbidden-communication-persistence-reexport', 'PERSISTENCE_FACADE_REEXPORT'],
    ['forbidden-communication-persistence-anonymous-default', 'PERSISTENCE_FACADE_EXTRA_EXPORT'],
    [
      'forbidden-communication-persistence-anonymous-default-class',
      'PERSISTENCE_FACADE_EXTRA_EXPORT',
    ],
    ['forbidden-communication-persistence-namespace-export', 'PERSISTENCE_FACADE_EXTRA_EXPORT'],
    ['forbidden-communication-persistence-object-destructure', 'PERSISTENCE_FACADE_EXTRA_EXPORT'],
    ['forbidden-communication-persistence-array-destructure', 'PERSISTENCE_FACADE_EXTRA_EXPORT'],
    ['forbidden-communication-persistence-aliased-export', 'PERSISTENCE_FACADE_EXTRA_EXPORT'],
    [
      'forbidden-communication-persistence-namespace-export-declaration',
      'PERSISTENCE_FACADE_EXTRA_EXPORT',
    ],
    [
      'forbidden-communication-persistence-namespace-export-same-name',
      'PERSISTENCE_FACADE_EXTRA_EXPORT',
    ],
    ['forbidden-communication-persistence-type-only-export', 'PERSISTENCE_FACADE_EXTRA_EXPORT'],
    ['forbidden-communication-persistence-export-equals', 'PERSISTENCE_FACADE_EXTRA_EXPORT'],
    ['forbidden-communication-persistence-export-star-as', 'PERSISTENCE_FACADE_EXPORT_STAR'],
    ['forbidden-communication-persistence-unclassified-export', 'PERSISTENCE_FACADE_EXTRA_EXPORT'],
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
