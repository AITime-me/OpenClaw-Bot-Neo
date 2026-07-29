/**
 * Quality-gate runner for local/review tooling.
 *
 * This is a non-production review check. On unsupported Node it enables
 * OPENCLAW_REVIEW_NODE_OVERRIDE=1 unless OPENCLAW_PRODUCTION_NODE_GATE=1 is set.
 * Production gate always forbids override and fails outside >=22.13.0 <23.
 */

import { spawnSync } from 'node:child_process';

const REVIEW_FLAG = 'OPENCLAW_REVIEW_NODE_OVERRIDE';
const PRODUCTION_FLAG = 'OPENCLAW_PRODUCTION_NODE_GATE';

if (process.env[PRODUCTION_FLAG] === '1') {
  process.env[REVIEW_FLAG] = '';
  console.warn(
    `[check] ${PRODUCTION_FLAG}=1 — strict production Node gate; review override disabled.`,
  );
} else {
  process.env[REVIEW_FLAG] = '1';
  console.warn(
    `[check] Non-production review/tooling run: ${REVIEW_FLAG}=1. ` +
      `This does NOT mark production Node compatibility as PASS. ` +
      `Set ${PRODUCTION_FLAG}=1 for strict production Node.`,
  );
}

const steps = [
  ['npm', ['run', 'check:node']],
  ['npm', ['run', 'typecheck']],
  ['npm', ['run', 'lint']],
  ['npm', ['run', 'format:check']],
  ['npm', ['run', 'test:run']],
  ['npm', ['run', 'check:boundaries']],
  ['npm', ['run', 'check:secrets']],
  ['npm', ['run', 'check:hygiene']],
];

for (const [command, args] of steps) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
