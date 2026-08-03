export declare const PRODUCTION_NODE_RANGE: '>=22.13.0 <23';

export declare const parseNodeVersion: (
  version: string,
) => { readonly major: number; readonly minor: number; readonly patch: number } | null;

export type SupportedNodeVersionDecision =
  { readonly ok: true } | { readonly ok: false; readonly reason: string };

export declare const evaluateSupportedNodeVersion: (
  version: string,
) => SupportedNodeVersionDecision;

export declare const formatUnsupportedNodeReason: (
  version: string,
  decision: SupportedNodeVersionDecision,
) => string;
