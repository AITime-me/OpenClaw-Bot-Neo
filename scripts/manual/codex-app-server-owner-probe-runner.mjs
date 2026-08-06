#!/usr/bin/env node
/**
 * Owner-approved probe runner. Invoked only after exact confirmation by the wrapper.
 * Creates a one-shot owner capability and always enters the probe path after confirmation.
 * Version is read from the same pinned absolute executable via fixed `--version` argv (shell:false).
 * Repository root is derived only from this script location (no env override).
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REQUIRED = 'OWNER_APPROVE_SINGLE_NON_PERSISTENT_CODEX_PROBE';
if (process.env.OWNER_PROBE_CONFIRMATION !== REQUIRED) {
  process.stderr.write('REFUSED: confirmation missing inside runner.\n');
  process.exit(2);
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const absolutePath = process.env.CODEX_PIN_ABSOLUTE_PATH;
const expectedVersion = process.env.CODEX_PIN_VERSION;
const sha256 = process.env.CODEX_PIN_SHA256;
const sizeBytes = Number(process.env.CODEX_PIN_SIZE_BYTES);
const codexHome = process.env.CODEX_PROBE_HOME;

process.stderr.write('Owner confirmation accepted; one-shot capability path entered.\n');

const failExecuted = (message) => {
  process.stderr.write(`${message}\n`);
  process.stderr.write('LIVE_PROBE_STATUS: EXECUTED_FAIL\n');
  process.exit(1);
};

if (!absolutePath || !expectedVersion || !sha256 || !Number.isFinite(sizeBytes) || !codexHome) {
  failExecuted('Owner capability gate passed. Pin/home env incomplete — refusing live spawn.');
}

const loadTs = async (relativePath) => {
  const distPath = join(repoRoot, 'dist', relativePath.replace(/\.ts$/, '.js'));
  if (!existsSync(distPath)) {
    throw new Error(`built module missing: ${distPath}; run npm run build first`);
  }
  return import(pathToFileURL(distPath).href);
};

const main = async () => {
  const { issueOwnerSpawnCapability } = await loadTs(
    'communication/adapters/codex-app-server/codex-app-server-owner-capability.js',
  );
  const { runCodexAppServerCapabilityProbe } = await loadTs(
    'communication/adapters/codex-app-server/codex-app-server-capability-probe.js',
  );
  const { readPinnedExecutableVersion } = await loadTs(
    'communication/adapters/codex-app-server/codex-app-server-executable-pin.js',
  );

  let actualVersion;
  try {
    actualVersion = readPinnedExecutableVersion(absolutePath);
  } catch (error) {
    failExecuted(`PROBE_VERSION_ERROR: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  if (actualVersion !== expectedVersion) {
    failExecuted(`PROBE_VERSION_MISMATCH: actual=${actualVersion} expected=${expectedVersion}`);
    return;
  }

  const issued = issueOwnerSpawnCapability({
    confirmation: process.env.OWNER_PROBE_CONFIRMATION,
  });
  if (!issued.ok) {
    failExecuted(`REFUSED: ${issued.reason}`);
    return;
  }

  const result = await runCodexAppServerCapabilityProbe({
    ownerCapability: issued.capability,
    config: {
      pin: {
        absolutePath,
        version: expectedVersion,
        sha256,
        sizeBytes,
        argv: ['app-server'],
      },
      codexHome,
      repositoryRoot: repoRoot,
      readVersion: readPinnedExecutableVersion,
    },
  });

  if (!result.ok) {
    failExecuted(`PROBE_CONFIG_ERROR: ${result.error.reason}`);
    return;
  }

  process.stderr.write(`PROBE_OUTCOME: ${result.value.outcome}\n`);
  if (
    result.value.outcome === 'completed' &&
    result.value.kind === 'completed' &&
    result.value.text === '{"ok":true}'
  ) {
    process.stderr.write('LIVE_PROBE_STATUS: EXECUTED_PASS\n');
    process.exit(0);
  }
  process.stderr.write('LIVE_PROBE_STATUS: EXECUTED_FAIL\n');
  process.exit(1);
};

main().catch((error) => {
  process.stderr.write(`PROBE_FATAL: ${error instanceof Error ? error.message : String(error)}\n`);
  process.stderr.write('LIVE_PROBE_STATUS: EXECUTED_FAIL\n');
  process.exit(1);
});
