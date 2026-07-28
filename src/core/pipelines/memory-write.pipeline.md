# Memory write pipeline

## Input

Authenticated memory access context, candidate content, candidate metadata, explicit target
namespace and an optional owner grant.

## Ordered flow

This order is implemented by `executeMemoryWrite` in `src/core/application/memory-write.service.ts`
and verified structurally by `scripts/verify-memory-isolation.mjs`.

1. validate operation context
2. normalize input
3. classify source
4. mark untrusted content
5. scan text with SensitiveDataScanner
6. scan metadata with SensitiveDataScanner
7. deny or redact
8. classify privacy
9. resolve and authorize namespace from the authenticated context
10. apply MemoryPolicy
11. validate and consume the approval when one is required
12. write through MemoryPort
13. write safe metadata through MemoryAuditPort

## Invariants

- Policy gates run before side effects; approval gates cannot be bypassed.
- Every job has an idempotency key, explicit timeout and cancellation signal.
- Cancellation stops downstream work; failure and cancellation both trigger cleanup.
- Audit stores provenance, policy decisions, provider class and redacted errors, never raw secrets or content.
- An unavailable capability returns an explicit safe failure and never imitates success.
- A scanner failure, policy deny, authorization deny or approval failure stops the flow before any sink.
- An audit failure is reported as a failure and never converted into a success.
- Forbidden shortcuts: hidden provider selection, paid fallback, writes before validation, retries without a finite limit, and cleanup omission.

Writing to MemoryPort before SensitiveDataScanner is forbidden, and the sink accepts only the
sealed write contract produced by this pipeline.
