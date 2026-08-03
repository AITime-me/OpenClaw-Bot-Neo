/**
 * Fail-fast Node runtime gate for CI and local tooling.
 * Production range authority: scripts/lib/node-version-contract.mjs
 * Review override: OPENCLAW_REVIEW_NODE_OVERRIDE=1
 * Production gate (forbids override): OPENCLAW_PRODUCTION_NODE_GATE=1
 */

import { pathToFileURL } from 'node:url';
import {
  evaluateSupportedNodeVersion,
  PRODUCTION_NODE_RANGE,
} from './lib/node-version-contract.mjs';

const REVIEW_FLAG = 'OPENCLAW_REVIEW_NODE_OVERRIDE';
const PRODUCTION_FLAG = 'OPENCLAW_PRODUCTION_NODE_GATE';

export { parseNodeVersion, PRODUCTION_NODE_RANGE } from './lib/node-version-contract.mjs';

export const resolveReviewOverrideAllowed = (env = process.env) =>
  env[PRODUCTION_FLAG] !== '1' && env[REVIEW_FLAG] === '1';

export const evaluateNodeSupport = (version, options = {}) => {
  const decision = evaluateSupportedNodeVersion(version);
  if (decision.ok) return { ok: true, mode: 'production' };
  if (options.allowUnsupportedReviewOverride === true) {
    return {
      ok: true,
      mode: 'review-override',
      reason: `Node ${version} is outside ${PRODUCTION_NODE_RANGE}; review override enabled.`,
    };
  }
  return decision;
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
