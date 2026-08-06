import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assertPinnedAbsolutePath,
  argvAllowed,
  createSpawnSpec,
  hashFileSha256,
  readExecutableSizeBytes,
  readPinnedExecutableVersion,
  verifyPinImmediatelyBeforeSpawn,
} from '../../src/communication/adapters/codex-app-server/codex-app-server-executable-pin.js';
import {
  buildIsolatedProbeContour,
  readableRootsForProbe,
  validateModelReadableRoots,
} from '../../src/communication/adapters/codex-app-server/codex-app-server-isolation.js';
import {
  consumeOwnerSpawnCapability,
  issueOwnerSpawnCapability,
  isOwnerSpawnCapability,
  OWNER_PROBE_CONFIRMATION_VALUE,
} from '../../src/communication/adapters/codex-app-server/codex-app-server-owner-capability.js';
import { createChildProcessTransport } from '../../src/communication/adapters/codex-app-server/codex-app-server-client.js';
import { createCodexAppServerLlmCompletion } from '../../src/communication/adapters/codex-app-server/codex-app-server-llm-completion.js';

const repoRoot = resolve(process.cwd());

describe('codex-app-server executable pin', () => {
  it('rejects basename and relative paths', () => {
    expect(assertPinnedAbsolutePath('codex').ok).toBe(false);
    expect(assertPinnedAbsolutePath('./codex').ok).toBe(false);
  });

  it('requires exact stdio argv and rejects forbidden flags', () => {
    expect(argvAllowed(['app-server']).ok).toBe(true);
    expect(argvAllowed(['app-server', '--listen', 'stdio://']).ok).toBe(true);
    expect(argvAllowed(['app-server', '--listen', 'ws://127.0.0.1']).ok).toBe(false);
    expect(argvAllowed(['app-server', '--provider', 'openai']).ok).toBe(false);
    expect(argvAllowed(['app-server', '--config', 'x.toml']).ok).toBe(false);
  });

  it('verifies version/hash/size immediately before spawn', () => {
    const dir = mkdtempSync(join(tmpdir(), 'neo-codex-pin-'));
    const absolutePath = join(dir, 'codex-bin');
    writeFileSync(absolutePath, 'fake-binary');
    const sha256 = hashFileSha256(absolutePath);
    const sizeBytes = readExecutableSizeBytes(absolutePath);
    const pin = {
      absolutePath,
      version: '1.2.3',
      sha256,
      sizeBytes,
      argv: ['app-server'] as const,
    };
    expect(verifyPinImmediatelyBeforeSpawn(pin, { readVersion: () => '1.2.3' }).ok).toBe(true);
    expect(verifyPinImmediatelyBeforeSpawn(pin, { readVersion: () => '9.9.9' }).ok).toBe(false);
    const envHome = join(dir, 'home');
    mkdirSync(envHome);
    const isolated = buildIsolatedProbeContour({
      codexHome: envHome,
      repositoryRoot: repoRoot,
    });
    expect(isolated.ok).toBe(true);
    if (!isolated.ok) return;
    const spec = createSpawnSpec(
      pin,
      {
        codexHome: isolated.paths.codexHome,
        home: isolated.paths.home,
        tempDir: isolated.paths.tempDir,
      },
      { readVersion: () => '1.2.3', cwd: isolated.paths.probeCwd },
    );
    expect(spec.ok).toBe(true);
    if (!spec.ok) return;
    expect(spec.spec.options.shell).toBe(false);
    expect(spec.spec.options.env.PATH).toBeUndefined();
    expect(spec.spec.options.cwd).toBe(isolated.paths.probeCwd);
  });

  it('rejects hash mismatch', () => {
    const dir = mkdtempSync(join(tmpdir(), 'neo-codex-pin-'));
    const absolutePath = join(dir, 'codex-bin');
    writeFileSync(absolutePath, 'fake-binary');
    const pin = {
      absolutePath,
      version: '1.2.3',
      sha256: '0'.repeat(64),
      sizeBytes: readExecutableSizeBytes(absolutePath),
      argv: ['app-server'] as const,
    };
    expect(verifyPinImmediatelyBeforeSpawn(pin, { readVersion: () => '1.2.3' }).ok).toBe(false);
  });

  it('detects version mismatch from a real fake executable via fixed --version command', () => {
    const absolutePath = process.execPath;
    const actual = readPinnedExecutableVersion(absolutePath);
    expect(actual.length).toBeGreaterThan(0);
    const pin = {
      absolutePath,
      version: `${actual}-mismatch`,
      sha256: hashFileSha256(absolutePath),
      sizeBytes: readExecutableSizeBytes(absolutePath),
      argv: ['app-server'] as const,
    };
    expect(
      verifyPinImmediatelyBeforeSpawn(pin, { readVersion: readPinnedExecutableVersion }).ok,
    ).toBe(false);
  });
});

describe('codex-app-server isolation', () => {
  it('rejects repository cwd and shared developer homes; readable roots are probe cwd only', () => {
    const badRepo = buildIsolatedProbeContour({
      codexHome: repoRoot,
      repositoryRoot: repoRoot,
    });
    expect(badRepo.ok).toBe(false);

    const nested = mkdtempSync(join(tmpdir(), 'neo-iso-'));
    const okContour = buildIsolatedProbeContour({
      codexHome: nested,
      repositoryRoot: repoRoot,
    });
    expect(okContour.ok).toBe(true);
    if (!okContour.ok) return;
    const roots = readableRootsForProbe(okContour.paths);
    expect(roots).toEqual([okContour.paths.probeCwd]);
    expect(roots).not.toContain(okContour.paths.codexHome);
    expect(validateModelReadableRoots(roots, okContour.paths).ok).toBe(true);
    expect(validateModelReadableRoots([okContour.paths.codexHome], okContour.paths).ok).toBe(false);
  });
});

describe('codex-app-server owner gate', () => {
  it('refuses live llm factory without owner capability', async () => {
    const llm = createCodexAppServerLlmCompletion({
      pin: {
        absolutePath: join(tmpdir(), 'missing-bin'),
        version: '1',
        sha256: '0'.repeat(64),
        sizeBytes: 1,
        argv: ['app-server'],
      },
    });
    const result = await llm.complete(
      {
        prompt: {
          ownerId: 'o' as never,
          conversationId: 'c' as never,
          policyVersion: '1' as never,
          sections: [] as never,
          totalUtf8Bytes: 0,
        },
        turnId: 't' as never,
        correlationId: 'c' as never,
        conversationId: 'c' as never,
        ownerId: 'o' as never,
        deadlineMs: 1,
        abortSignal: null,
      },
      {} as never,
    );
    expect(result.ok).toBe(false);
  });

  it('rejects capability clone/spread/reset and reuse', () => {
    const issued = issueOwnerSpawnCapability({ confirmation: OWNER_PROBE_CONFIRMATION_VALUE });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    expect(isOwnerSpawnCapability(issued.capability)).toBe(true);
    expect(isOwnerSpawnCapability({ ...issued.capability })).toBe(false);
    expect(isOwnerSpawnCapability(Object.assign({}, issued.capability))).toBe(false);
    expect(consumeOwnerSpawnCapability(issued.capability).ok).toBe(true);
    expect(consumeOwnerSpawnCapability(issued.capability).ok).toBe(false);
    expect(issueOwnerSpawnCapability({ confirmation: 'nope' }).ok).toBe(false);
  });

  it('manual script negative path creates no process', () => {
    const script = join(repoRoot, 'scripts/manual/codex-app-server-owner-probe.mjs');
    const result = spawnSync(process.execPath, [script], {
      env: { ...process.env, OWNER_PROBE_CONFIRMATION: 'wrong' },
      encoding: 'utf8',
      shell: false,
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('REFUSED');
  });

  it('manual script positive path invokes runner and reports EXECUTED_FAIL without pin', () => {
    const script = join(repoRoot, 'scripts/manual/codex-app-server-owner-probe.mjs');
    const result = spawnSync(process.execPath, [script], {
      env: {
        ...process.env,
        OWNER_PROBE_CONFIRMATION: OWNER_PROBE_CONFIRMATION_VALUE,
      },
      encoding: 'utf8',
      shell: false,
    });
    expect(result.status).toBe(1);
    const output = `${result.stderr}${result.stdout}`;
    expect(output).toContain('LIVE_PROBE_STATUS: EXECUTED_FAIL');
    expect(output).not.toContain('LIVE_PROBE_STATUS: NOT_RUN');
    expect(output).toContain('Owner confirmation accepted');
  });

  it('runner derives repository root from script location and ignores env override', () => {
    const runner = join(repoRoot, 'scripts/manual/codex-app-server-owner-probe-runner.mjs');
    const source = readFileSync(runner, 'utf8');
    expect(source).toContain("resolve(dirname(fileURLToPath(import.meta.url)), '../..')");
    expect(source).not.toContain('CODEX_PROBE_REPO_ROOT');
    expect(source).toContain('readPinnedExecutableVersion');
    expect(source).toContain('EXECUTED_PASS');
    expect(source).toContain('EXECUTED_FAIL');
    void dirname;
    void fileURLToPath;
  });

  it('createChildProcessTransport requires genuine owner capability', () => {
    const dir = mkdtempSync(join(tmpdir(), 'neo-gate-'));
    const absolutePath = join(dir, 'bin');
    writeFileSync(absolutePath, 'x');
    const isolated = buildIsolatedProbeContour({
      codexHome: join(dir, 'home'),
      repositoryRoot: repoRoot,
    });
    expect(isolated.ok).toBe(true);
    if (!isolated.ok) return;
    const pin = {
      absolutePath,
      version: '1',
      sha256: hashFileSha256(absolutePath),
      sizeBytes: readExecutableSizeBytes(absolutePath),
      argv: ['app-server'] as const,
    };
    const denied = createChildProcessTransport({
      pin,
      envInput: {
        codexHome: isolated.paths.codexHome,
        home: isolated.paths.home,
        tempDir: isolated.paths.tempDir,
      },
      cwd: isolated.paths.probeCwd,
      readVersion: () => '1',
      ownerCapability: { nonce: 'forged' },
    });
    expect(denied.ok).toBe(false);
  });
});

void createHash;
