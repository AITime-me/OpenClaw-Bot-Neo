# Video URL pipeline

## Input

A URL supplied as untrusted input.

## Ordered flow

1. Perform syntactic URL policy validation.
2. Require future runtime resolved-IP and DNS-rebinding validation.
3. Revalidate every redirect and enforce redirect, byte and time limits.
4. Reject DRM, authorization bypass and credential-bearing URLs.
5. Ingest into quarantine and continue through uploaded-video flow.

## Invariants

- Policy gates run before side effects; approval gates cannot be bypassed.
- Every job has an idempotency key, explicit timeout and cancellation signal.
- Cancellation stops downstream work; failure and cancellation both trigger cleanup.
- Audit stores provenance, policy decisions, provider class and redacted errors, never raw secrets or content.
- An unavailable capability returns an explicit safe failure and never imitates success.
- Forbidden shortcuts: hidden provider selection, paid fallback, writes before validation, retries without a finite limit, and cleanup omission.
