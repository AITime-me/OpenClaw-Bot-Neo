/**
 * Canonical dependency-free production Node runtime contract for OpenClaw Bot Neo.
 * Launcher and CI authority: >=22.13.0 <23.
 *
 * Accepts process.versions.node format (e.g. "22.13.0"). Optional prerelease/build suffix
 * after patch is ignored for comparison (e.g. "22.13.0-nightly", "22.14.0+build").
 * Leading "v" prefix is not accepted. Whitespace is trimmed.
 */

export const PRODUCTION_NODE_RANGE = '>=22.13.0 <23';

/**
 * @param {string} version
 * @returns {{ major: number; minor: number; patch: number } | null}
 */
export const parseNodeVersion = (version) => {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(version).trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
};

/**
 * Pure production support evaluator. No environment, filesystem, or process side effects.
 *
 * @param {string} version
 * @returns {{ ok: true } | { ok: false; reason: string }}
 */
export const evaluateSupportedNodeVersion = (version) => {
  const parsed = parseNodeVersion(version);
  if (parsed === null) return { ok: false, reason: `Malformed Node version "${version}".` };
  const supported =
    parsed.major === 22 && (parsed.minor > 13 || (parsed.minor === 13 && parsed.patch >= 0));
  if (supported) return { ok: true };
  return {
    ok: false,
    reason: `Node ${version} is outside the production support range ${PRODUCTION_NODE_RANGE}.`,
  };
};

/**
 * @param {string} version
 * @param {{ ok: false; reason: string }} decision
 * @returns {string}
 */
export const formatUnsupportedNodeReason = (version, decision) => {
  if (decision !== undefined && decision.ok === false && typeof decision.reason === 'string') {
    return decision.reason;
  }
  return `Node ${version} is outside the production support range ${PRODUCTION_NODE_RANGE}.`;
};
