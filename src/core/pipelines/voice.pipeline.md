# Voice pipeline

## Input

Validated channel-neutral audio asset.

## Ordered flow

1. Validate content signature, size and duration.
2. Store temporarily under a random identifier.
3. Apply media and privacy policy.
4. Resolve SpeechToText capability without paid fallback.
5. Transcribe and link derivative to source.
6. Send transcript as untrusted input to the AI core.
7. Optionally resolve TextToSpeech after owner policy.
8. Deliver through the active channel port and clean temporary data.

## Invariants

- Policy gates run before side effects; approval gates cannot be bypassed.
- Every job has an idempotency key, explicit timeout and cancellation signal.
- Cancellation stops downstream work; failure and cancellation both trigger cleanup.
- Audit stores provenance, policy decisions, provider class and redacted errors, never raw secrets or content.
- An unavailable capability returns an explicit safe failure and never imitates success.
- Forbidden shortcuts: hidden provider selection, paid fallback, writes before validation, retries without a finite limit, and cleanup omission.
