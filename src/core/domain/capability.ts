export type CapabilityStatus =
  | { readonly state: 'available'; readonly provider: string }
  | { readonly state: 'unavailable'; readonly reason: string }
  | { readonly state: 'misconfigured'; readonly reason: string }
  | { readonly state: 'temporarily-unavailable'; readonly retryAfterSeconds: number }
  | { readonly state: 'approval-required'; readonly reason: string }
  | { readonly state: 'paid-provider-disabled'; readonly provider: string };
