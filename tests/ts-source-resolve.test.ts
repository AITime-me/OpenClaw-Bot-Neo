import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  isPathInsideRoot,
  isRelativeJsSpecifier,
  tryResolveTsSourceFallback,
} from '../scripts/integration/lib/ts-source-resolve-policy.mjs';

describe('ts-source-resolve-policy', () => {
  it('accepts only relative .js specifiers without query/hash', () => {
    expect(isRelativeJsSpecifier('./identity.js')).toBe(true);
    expect(isRelativeJsSpecifier('../x.js')).toBe(true);
    expect(isRelativeJsSpecifier('./x.mjs')).toBe(false);
    expect(isRelativeJsSpecifier('./x.cjs')).toBe(false);
    expect(isRelativeJsSpecifier('identity.js')).toBe(false);
    expect(isRelativeJsSpecifier('node:fs')).toBe(false);
    expect(isRelativeJsSpecifier('./x.js?v=1')).toBe(false);
    expect(isRelativeJsSpecifier('./x.js#hash')).toBe(false);
  });

  it('isPathInsideRoot is prefix-safe', () => {
    expect(isPathInsideRoot('/a/src/x', '/a/src')).toBe(true);
    expect(isPathInsideRoot('/a/src', '/a/src')).toBe(true);
    expect(isPathInsideRoot('/a/src2/x', '/a/src')).toBe(false);
  });

  it('remaps missing .js to sibling .ts inside src root', () => {
    const root = mkdtempSync(join(tmpdir(), 'oc-ts-resolve-'));
    try {
      const src = join(root, 'src');
      const domain = join(src, 'core');
      mkdirSync(domain, { recursive: true });
      writeFileSync(join(domain, 'index.ts'), 'export * from "./identity.js";\n');
      writeFileSync(join(domain, 'identity.ts'), 'export const ok = 1;\n');
      const result = tryResolveTsSourceFallback({
        specifier: './identity.js',
        parentURL: pathToFileURL(join(domain, 'index.ts')).href,
        srcRoot: src,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.url).toBe(pathToFileURL(join(domain, 'identity.ts')).href);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not remap when .js exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'oc-ts-resolve-'));
    try {
      const src = join(root, 'src');
      mkdirSync(src, { recursive: true });
      writeFileSync(join(src, 'a.ts'), 'export {};\n');
      writeFileSync(join(src, 'b.js'), 'export {};\n');
      writeFileSync(join(src, 'b.ts'), 'export {};\n');
      const result = tryResolveTsSourceFallback({
        specifier: './b.js',
        parentURL: pathToFileURL(join(src, 'a.ts')).href,
        srcRoot: src,
      });
      expect(result.ok).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not remap when both missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'oc-ts-resolve-'));
    try {
      const src = join(root, 'src');
      mkdirSync(src, { recursive: true });
      writeFileSync(join(src, 'a.ts'), 'export {};\n');
      const result = tryResolveTsSourceFallback({
        specifier: './missing.js',
        parentURL: pathToFileURL(join(src, 'a.ts')).href,
        srcRoot: src,
      });
      expect(result.ok).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects parent outside src root', () => {
    const root = mkdtempSync(join(tmpdir(), 'oc-ts-resolve-'));
    try {
      const src = join(root, 'src');
      const outside = join(root, 'outside');
      mkdirSync(src, { recursive: true });
      mkdirSync(outside, { recursive: true });
      writeFileSync(join(outside, 'a.ts'), 'export {};\n');
      writeFileSync(join(outside, 'b.ts'), 'export {};\n');
      const result = tryResolveTsSourceFallback({
        specifier: './b.js',
        parentURL: pathToFileURL(join(outside, 'a.ts')).href,
        srcRoot: src,
      });
      expect(result.ok).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects symlink escape outside src root', () => {
    const root = mkdtempSync(join(tmpdir(), 'oc-ts-resolve-'));
    try {
      const src = join(root, 'src');
      const outside = join(root, 'outside');
      mkdirSync(src, { recursive: true });
      mkdirSync(outside, { recursive: true });
      writeFileSync(join(src, 'a.ts'), 'export {};\n');
      writeFileSync(join(outside, 'secret.ts'), 'export const leak = 1;\n');
      try {
        symlinkSync(join(outside, 'secret.ts'), join(src, 'b.ts'));
      } catch {
        // Windows without symlink privilege: skip
        return;
      }
      const result = tryResolveTsSourceFallback({
        specifier: './b.js',
        parentURL: pathToFileURL(join(src, 'a.ts')).href,
        srcRoot: src,
      });
      expect(result.ok).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
