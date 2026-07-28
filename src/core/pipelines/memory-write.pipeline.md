# Memory write pipeline

## Input

Candidate content and explicit target namespace.

## Ordered flow

1. normalize input
2. classify source
3. mark untrusted content
4. run SensitiveDataScanner
5. deny or redact
6. classify privacy
7. resolve namespace
8. apply MemoryPolicy
9. request owner approval if required
10. write through MemoryPort
11. write metadata through MemoryAuditPort

## Invariants

- Policy gates run before side effects; approval gates cannot be bypassed.
- Every job has an idempotency key, explicit timeout and cancellation signal.
- Cancellation stops downstream work; failure and cancellation both trigger cleanup.
- Audit stores provenance, policy decisions, provider class and redacted errors, never raw secrets or content.
- An unavailable capability returns an explicit safe failure and never imitates success.
- Forbidden shortcuts: hidden provider selection, paid fallback, writes before validation, retries without a finite limit, and cleanup omission.

Writing to MemoryPort before SensitiveDataScanner is forbidden.
