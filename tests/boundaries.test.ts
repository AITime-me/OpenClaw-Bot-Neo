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
});

describe('allowlist-based layer rules', () => {
  it('accepts a compliant layered fixture', () => {
    const report = analyzeBoundaries({ rootDir: fixture('allowed') });
    expect(report.violations).toEqual([]);
    expect(report.filesAnalyzed).toBeGreaterThan(0);
  });

  it.each([
    ['forbidden-static', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-export-from', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-dynamic', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-renamed', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-external', 'EXTERNAL_DEPENDENCY'],
    ['forbidden-internal', 'INTERNAL_MODULE_LEAK'],
    ['cycle', 'CYCLE'],
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
  });
});
