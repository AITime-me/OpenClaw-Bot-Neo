# Uploaded video pipeline

## Input

Uploaded channel-neutral video asset.

## Ordered flow

1. Validate MIME signature, size and duration.
2. Store in quarantine and enqueue idempotently.
3. Extract audio and scenes through an available local capability.
4. Transcribe audio and analyze selected frames as untrusted input.
5. Combine redacted transcript, frames and metadata.
6. Notify owner and clean every temporary derivative.

## Invariants

- Policy gates run before side effects; approval gates cannot be bypassed.
- Every job has an idempotency key, explicit timeout and cancellation signal.
- Cancellation stops downstream work; failure and cancellation both trigger cleanup.
- Audit stores provenance, policy decisions, provider class and redacted errors, never raw secrets or content.
- An unavailable capability returns an explicit safe failure and never imitates success.
- Forbidden shortcuts: hidden provider selection, paid fallback, writes before validation, retries without a finite limit, and cleanup omission.
