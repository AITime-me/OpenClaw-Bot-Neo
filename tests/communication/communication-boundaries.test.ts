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
