import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeBoundaries } from '../../scripts/lib/boundary-checker.mjs';

const ADAPTER_ROOT = 'src/communication/adapters/codex-app-server';

const listTs = (root: string): string[] => {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return listTs(path);
    return path.endsWith('.ts') ? [path] : [];
  });
};

describe('codex-app-server boundaries', () => {
  it('keeps only codex-app-server under communication adapters', () => {
    expect(existsSync(ADAPTER_ROOT)).toBe(true);
    expect(
      existsSync('src/communication/adapters/codex-app-server/create-codex-app-server-route.ts'),
    ).toBe(true);
    const names = readdirSync('src/communication/adapters');
    expect(names).toEqual(['codex-app-server']);
  });

  it('forbids host/sqlite/production imports and credential file reads in adapter sources', () => {
    for (const file of listTs(ADAPTER_ROOT)) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/from ['"].*host\/storage\/sqlite/);
      expect(source).not.toMatch(/from ['"].*neo-runtime\/production/);
      expect(source).not.toMatch(/from ['"].*adapters\/telegram/);
      expect(source).not.toMatch(/from ['"].*adapters\/openclaw/);
      expect(source).not.toMatch(/readFileSync\([^)]*auth\.json|readFile\([^)]*auth\.json/);
      expect(source).not.toMatch(/neo-communication\.sqlite/);
    }
  });

  it('passes structural layer analysis for the adapter tree', () => {
    const report = analyzeBoundaries({
      rootDir: 'src',
      requiredLayers: ['communication/adapters/codex-app-server'],
    });
    const adapterViolations = report.violations.filter((v) =>
      v.message.includes('communication/adapters/codex-app-server'),
    );
    expect(adapterViolations).toEqual([]);
  });
});
