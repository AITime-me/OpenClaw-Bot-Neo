import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertPinnedAbsolutePath,
  createSpawnSpec,
  hashFileSha256,
  verifyPinImmediatelyBeforeSpawn,
} from '../../src/communication/adapters/codex-app-server/codex-app-server-executable-pin.js';

describe('codex-app-server executable pin', () => {
  it('rejects basename and relative paths', () => {
    expect(assertPinnedAbsolutePath('codex').ok).toBe(false);
    expect(assertPinnedAbsolutePath('./codex').ok).toBe(false);
  });

  it('verifies hash immediately before spawn and uses shell:false without PATH', () => {
    const dir = mkdtempSync(join(tmpdir(), 'neo-codex-pin-'));
    const absolutePath = join(dir, 'codex-bin');
    writeFileSync(absolutePath, 'fake-binary');
    const sha256 = hashFileSha256(absolutePath);
    expect(sha256).toBe(createHash('sha256').update('fake-binary').digest('hex'));
    const pin = {
      absolutePath,
      version: 'test',
      sha256,
      argv: ['app-server', '--listen', 'stdio://'] as const,
    };
    expect(verifyPinImmediatelyBeforeSpawn(pin).ok).toBe(true);
    const spec = createSpawnSpec(pin, { codexHome: dir });
    expect(spec.ok).toBe(true);
    if (!spec.ok) return;
    expect(spec.spec.command).toBe(absolutePath);
    expect(spec.spec.options.shell).toBe(false);
    expect(spec.spec.options.env.PATH).toBeUndefined();
  });

  it('rejects hash mismatch', () => {
    const dir = mkdtempSync(join(tmpdir(), 'neo-codex-pin-'));
    const absolutePath = join(dir, 'codex-bin');
    writeFileSync(absolutePath, 'fake-binary');
    const pin = {
      absolutePath,
      version: 'test',
      sha256: '0'.repeat(64),
      argv: ['app-server'] as const,
    };
    expect(verifyPinImmediatelyBeforeSpawn(pin).ok).toBe(false);
  });
});
