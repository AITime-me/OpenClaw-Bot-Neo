/**
 * Fail-fast Node runtime gate. Mirrors src/core/runtime/node-support.ts.
 * Production range: >=22.13.0 <23.
 * Review override: OPENCLAW_REVIEW_NODE_OVERRIDE=1
 * Production gate (forbids override): OPENCLAW_PRODUCTION_NODE_GATE=1
 */

import { pathToFileURL } from 'node:url';

const PRODUCTION_LABEL = '>=22.13.0 <23';
const REVIEW_FLAG = 'OPENCLAW_REVIEW_NODE_OVERRIDE';
const PRODUCTION_FLAG = 'OPENCLAW_PRODUCTION_NODE_GATE';

export const parseNodeVersion = (version) => {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(version).trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
};

export const resolveReviewOverrideAllowed = (env = process.env) =>
  env[PRODUCTION_FLAG] !== '1' && env[REVIEW_FLAG] === '1';

export const evaluateNodeSupport = (version, options = {}) => {
  const parsed = parseNodeVersion(version);
  if (parsed === null) return { ok: false, reason: `Malformed Node version "${version}".` };
  const supported =
    parsed.major === 22 &&
    (parsed.minor > 13 || (parsed.minor === 13 && parsed.patch >= 0)) &&
    parsed.major < 23;
  if (supported) return { ok: true, mode: 'production' };
  if (options.allowUnsupportedReviewOverride === true)
    return {
      ok: true,
      mode: 'review-override',
      reason: `Node ${version} is outside ${PRODUCTION_LABEL}; review override enabled.`,
    };
  return {
    ok: false,
    reason: `Node ${version} is outside the production support range ${PRODUCTION_LABEL}.`,
  };
};

const isCli =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isCli) {
  const decision = evaluateNodeSupport(process.versions.node, {
    allowUnsupportedReviewOverride: resolveReviewOverrideAllowed(process.env),
  });
  if (!decision.ok) {
    console.error(decision.reason);
    console.error(
      `For local review/tooling only: set ${REVIEW_FLAG}=1. Production path: ${PRODUCTION_FLAG}=1 (override forbidden).`,
    );
    process.exit(1);
  }
  if (decision.mode === 'review-override') console.warn(`[check:node] ${decision.reason}`);
  console.log(
    `Node ${process.versions.node} accepted for ${decision.mode === 'review-override' ? 'review-override' : 'production'} mode.`,
  );
}
