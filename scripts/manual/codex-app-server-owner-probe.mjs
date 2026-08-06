#!/usr/bin/env node
/**
 * Manual owner-approved Codex app-server capability probe.
 * NOT part of default npm check / CI.
 *
 * Requires:
 *   OWNER_PROBE_CONFIRMATION=OWNER_APPROVE_SINGLE_NON_PERSISTENT_CODEX_PROBE
 * Plus pin/home env vars when actually spawning (still refuses without confirmation).
 *
 * Does not run automatically. Does not read credential file contents into Neo logs.
 */
const REQUIRED = 'OWNER_APPROVE_SINGLE_NON_PERSISTENT_CODEX_PROBE';

if (process.env.OWNER_PROBE_CONFIRMATION !== REQUIRED) {
  process.stderr.write(
    'REFUSED: set OWNER_PROBE_CONFIRMATION=' +
      REQUIRED +
      ' for a single non-persistent owner-approved probe.\n',
  );
  process.exit(2);
}

process.stderr.write(
  'Owner confirmation present. Live Codex spawn is still gated on pin env vars and is not run by default CI.\n',
);
process.stderr.write('LIVE_PROBE_STATUS: NOT_RUN (manual script scaffold only in this Build).\n');
process.exit(0);
