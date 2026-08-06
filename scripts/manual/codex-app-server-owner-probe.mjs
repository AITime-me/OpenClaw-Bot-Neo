#!/usr/bin/env node
/**
 * Manual owner-approved Codex app-server capability probe.
 * NOT part of default npm check / CI.
 *
 * Requires:
 *   OWNER_PROBE_CONFIRMATION=OWNER_APPROVE_SINGLE_NON_PERSISTENT_CODEX_PROBE
 * Plus pin/home env vars for live spawn.
 *
 * Does not run automatically. Does not read credential file contents into Neo logs.
 * Confirmation always invokes the runner; status is EXECUTED_PASS / EXECUTED_FAIL after entry.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED = 'OWNER_APPROVE_SINGLE_NON_PERSISTENT_CODEX_PROBE';
const here = dirname(fileURLToPath(import.meta.url));
const runner = join(here, 'codex-app-server-owner-probe-runner.mjs');

if (process.env.OWNER_PROBE_CONFIRMATION !== REQUIRED) {
  process.stderr.write(
    'REFUSED: set OWNER_PROBE_CONFIRMATION=' +
      REQUIRED +
      ' for a single non-persistent owner-approved probe.\n',
  );
  process.exit(2);
}

if (!existsSync(runner)) {
  process.stderr.write('REFUSED: owner probe runner missing.\n');
  process.exit(2);
}

const result = spawnSync(process.execPath, [runner], {
  env: process.env,
  stdio: 'inherit',
  shell: false,
});

process.exit(result.status === null ? 1 : result.status);
