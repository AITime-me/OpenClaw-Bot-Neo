export { parseNodeVersion, PRODUCTION_NODE_RANGE } from './lib/node-version-contract.mjs';

export declare const resolveReviewOverrideAllowed: (env?: NodeJS.ProcessEnv) => boolean;

export type NodeSupportDecision =
  | { readonly ok: true; readonly mode: 'production' }
  | { readonly ok: true; readonly mode: 'review-override'; readonly reason: string }
  | { readonly ok: false; readonly reason: string };

export declare const evaluateNodeSupport: (
  version: string,
  options?: { readonly allowUnsupportedReviewOverride?: boolean },
) => NodeSupportDecision;
