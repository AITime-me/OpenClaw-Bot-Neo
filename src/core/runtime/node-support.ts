/**
 * Production Node runtime contract for OpenClaw Bot Neo.
 *
 * Supported production range: Node >=22.13.0 <23 (Node 22 LTS line).
 * Node 23/24 are not production-supported.
 *
 * Review/tooling may opt in with OPENCLAW_REVIEW_NODE_OVERRIDE=1.
 * OPENCLAW_PRODUCTION_NODE_GATE=1 always forbids override (production path).
 */

export const PRODUCTION_NODE_RANGE = Object.freeze({
  label: '>=22.13.0 <23',
  minMajor: 22,
  minMinor: 13,
  minPatch: 0,
  maxMajorExclusive: 23,
});

export const REVIEW_NODE_OVERRIDE_ENV = 'OPENCLAW_REVIEW_NODE_OVERRIDE';
export const PRODUCTION_NODE_GATE_ENV = 'OPENCLAW_PRODUCTION_NODE_GATE';

export type NodeSupportDecision =
  | { readonly ok: true; readonly mode: 'production' }
  | { readonly ok: true; readonly mode: 'review-override'; readonly reason: string }
  | { readonly ok: false; readonly reason: string };

export const parseNodeVersion = (
  version: string,
): { readonly major: number; readonly minor: number; readonly patch: number } | null => {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
};

export const resolveReviewOverrideAllowed = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env[PRODUCTION_NODE_GATE_ENV] !== '1' && env[REVIEW_NODE_OVERRIDE_ENV] === '1';

export const evaluateNodeSupport = (
  version: string,
  options: { readonly allowUnsupportedReviewOverride?: boolean } = {},
): NodeSupportDecision => {
  const parsed = parseNodeVersion(version);
  if (parsed === null) return { ok: false, reason: `Malformed Node version "${version}".` };
  const { minMajor, minMinor, minPatch, maxMajorExclusive } = PRODUCTION_NODE_RANGE;
  const inMajorWindow = parsed.major >= minMajor && parsed.major < maxMajorExclusive;
  const meetsFloor =
    parsed.major > minMajor ||
    parsed.minor > minMinor ||
    (parsed.minor === minMinor && parsed.patch >= minPatch);
  const supported = inMajorWindow && meetsFloor;
  if (supported) return { ok: true, mode: 'production' };
  if (options.allowUnsupportedReviewOverride === true)
    return {
      ok: true,
      mode: 'review-override',
      reason: `Node ${version} is outside ${PRODUCTION_NODE_RANGE.label}; review override enabled.`,
    };
  return {
    ok: false,
    reason: `Node ${version} is outside the production support range ${PRODUCTION_NODE_RANGE.label}.`,
  };
};

export const assertProductionNode = (
  version: string = process.versions.node,
  env: NodeJS.ProcessEnv = process.env,
): void => {
  const decision = evaluateNodeSupport(version, {
    allowUnsupportedReviewOverride: resolveReviewOverrideAllowed(env),
  });
  if (!decision.ok) {
    console.error(decision.reason);
    process.exit(1);
  }
  if (decision.mode === 'review-override') console.warn(`[check:node] ${decision.reason}`);
};
