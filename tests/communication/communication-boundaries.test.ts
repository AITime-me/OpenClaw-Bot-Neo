import { describe, expect, it } from 'vitest';
import { analyzeBoundaries } from '../../scripts/lib/boundary-checker.mjs';

const fixture = (name: string): string => `tests/fixtures/boundaries/${name}`;
const codes = (report: { violations: readonly { code: string }[] }): readonly string[] =>
  report.violations.map((violation) => violation.code);

describe('communication boundary fixtures', () => {
  it('accepts the communication-allowed fixture', () => {
    const report = analyzeBoundaries({
      rootDir: fixture('communication-allowed'),
      requiredLayers: [],
    });
    expect(report.violations).toEqual([]);
  });

  it.each([
    ['forbidden-core-telegram-sdk', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-communication-imports-connector', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-communication-imports-infrastructure', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-communication-barrel-via-domain-index', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-communication-barrel-via-ports-index', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-host-imports-telegram-adapter', 'FORBIDDEN_DEPENDENCY'],
    ['forbidden-communication-principal-internal', 'INTERNAL_MODULE_LEAK'],
  ])('rejects fixture %s with %s', (name, code) => {
    const report = analyzeBoundaries({ rootDir: fixture(name), requiredLayers: [] });
    expect(codes(report)).toContain(code);
  });
});

describe('production communication tree', () => {
  it('has no boundary violations in src', () => {
    const report = analyzeBoundaries({
      rootDir: 'src',
      requiredLayers: [
        'core/communication/domain',
        'core/communication/ports',
        'core/communication/policy',
      ],
    });
    expect(report.violations).toEqual([]);
    expect(report.filesAnalyzed).toBeGreaterThan(20);
  }, 30_000);
});
