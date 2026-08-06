#!/usr/bin/env node
/**
 * Owner-approved probe runner. Invoked only after exact confirmation by the wrapper.
 * Creates a one-shot owner capability and calls the probe entry when pin/home env is present.
 * Without pin env: capability is issued in-process and LIVE_PROBE_STATUS: NOT_RUN (no child spawn).
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
const version = process.env.CODEX_PIN_VERSION;
const sha256 = process.env.CODEX_PIN_SHA256;
const sizeBytes = Number(process.env.CODEX_PIN_SIZE_BYTES);
const codexHome = process.env.CODEX_PROBE_HOME;
const repositoryRoot = process.env.CODEX_PROBE_REPO_ROOT ?? repoRoot;

process.stderr.write('Owner confirmation accepted; one-shot capability path entered.\n');

if (!absolutePath || !version || !sha256 || !Number.isFinite(sizeBytes) || !codexHome) {
  process.stderr.write(
    'Owner capability gate passed. Pin/home env incomplete — refusing live spawn.\n',
  );
  process.stderr.write('LIVE_PROBE_STATUS: NOT_RUN\n');
  process.exit(0);
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

  const issued = issueOwnerSpawnCapability({
    confirmation: process.env.OWNER_PROBE_CONFIRMATION,
  });
  if (!issued.ok) {
    process.stderr.write(`REFUSED: ${issued.reason}\n`);
    process.exit(2);
  }

  const result = await runCodexAppServerCapabilityProbe({
    ownerCapability: issued.capability,
    config: {
      pin: {
        absolutePath,
        version,
        sha256,
        sizeBytes,
        argv: ['app-server'],
      },
      codexHome,
      repositoryRoot,
      readVersion: () => version,
    },
  });

  if (!result.ok) {
    process.stderr.write(`PROBE_CONFIG_ERROR: ${result.error.reason}\n`);
    process.stderr.write('LIVE_PROBE_STATUS: NOT_RUN\n');
    process.exit(1);
  }

  process.stderr.write(`PROBE_OUTCOME: ${result.value.outcome}\n`);
  process.stderr.write('LIVE_PROBE_STATUS: NOT_RUN\n');
  process.exit(0);
};

main().catch((error) => {
  process.stderr.write(`PROBE_FATAL: ${error instanceof Error ? error.message : String(error)}\n`);
  process.stderr.write('LIVE_PROBE_STATUS: NOT_RUN\n');
  process.exit(1);
});
