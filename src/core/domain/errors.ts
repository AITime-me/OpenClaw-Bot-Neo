export type DomainError =
  | { readonly code: 'CAPABILITY_UNAVAILABLE'; readonly capability: string }
  | { readonly code: 'NOT_CONFIGURED'; readonly component: string }
  | { readonly code: 'VALIDATION_FAILED'; readonly reason: string }
  | { readonly code: 'POLICY_DENIED'; readonly reason: string }
  | { readonly code: 'APPROVAL_REQUIRED'; readonly action: string }
  | { readonly code: 'TIMEOUT'; readonly operation: string }
  | { readonly code: 'CANCELLED'; readonly operation: string }
  | { readonly code: 'EXTERNAL_FAILURE'; readonly operation: string; readonly retryable: boolean };
