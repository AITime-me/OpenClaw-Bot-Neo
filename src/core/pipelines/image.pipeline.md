# Image pipeline

## Input

One or more channel-neutral image assets.

## Ordered flow

1. Validate signature, size and resolution and remove unnecessary metadata.
2. Quarantine until validation succeeds.
3. Run scanner and media policy.
4. Resolve understanding, OCR, generation or editing capability explicitly.
5. Request approval for external or paid processing.
6. Process asynchronously where required.
7. Return derivatives through the channel and clean source data.

## Invariants

- Policy gates run before side effects; approval gates cannot be bypassed.
- Every job has an idempotency key, explicit timeout and cancellation signal.
- Cancellation stops downstream work; failure and cancellation both trigger cleanup.
- Audit stores provenance, policy decisions, provider class and redacted errors, never raw secrets or content.
- An unavailable capability returns an explicit safe failure and never imitates success.
- Forbidden shortcuts: hidden provider selection, paid fallback, writes before validation, retries without a finite limit, and cleanup omission.
