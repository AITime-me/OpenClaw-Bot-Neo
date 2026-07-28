export type MemoryWriteDecision =
  | { readonly decision: 'allow' }
  | { readonly decision: 'deny'; readonly reason: string }
  | { readonly decision: 'approval-required'; readonly reason: string };
