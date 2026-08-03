# Memory write pipeline

## Input

Authenticated memory access context, candidate content, candidate metadata, explicit target
namespace and an optional `approvalId`. Callers never supply an approval demand, payload digest or
validation timestamp.

## Ordered flow

This order is implemented by `executeMemoryWrite` in `src/core/application/memory-write.service.ts`
and verified structurally by `scripts/verify-memory-isolation.mjs` against that function body only.

1. validate operation context
2. read one trusted timestamp from the application clock port
3. normalize input and classify source
4. mark untrusted content when the source is not owner-stated
   4b. enforce mandatory non-overrideable secret-class/provenance boundary (`SECRET_CLASS_DENIED`)
5. scan text with SensitiveDataScanner
6. scan metadata keys and values with SensitiveDataScanner
7. deny or redact scanner-detected secrets
8. classify privacy
9. resolve and authorize namespace from the authenticated context
10. apply MemoryPolicy
11. when approval is required: derive the approval demand from the actual sanitized operation
12. validate the looked-up grant against that demand using the trusted timestamp
13. consume the grant atomically through ApprovalPort
14. issue mandatory secret-boundary clearance and seal verified write
15. write through MemoryPort (sink rejects writes without clearance)
16. write safe metadata through MemoryAuditPort (`metadataFieldCount`, never raw user key names)

## Invariants

- Policy gates run before side effects; approval gates cannot be bypassed.
- Approval demand is built inside the trusted application boundary from the actual operation
  (owner, actor, effect, target, namespace, project scope, payload digest over content/metadata).
- Callers cannot pass `command.now`; expiry is checked against the trusted operation timestamp.
- Atomic approval consumption is a port-contract requirement: two concurrent consumes must not both
  succeed. This repository does not ship a transactional store implementation.
- Every job has an idempotency key, explicit timeout and cancellation signal.
- Cancellation stops downstream work; failure and cancellation both trigger cleanup.
- Audit stores provenance, policy decisions, finding categories and field counts, never raw secrets,
  raw content or raw user-controlled metadata key names.
- An unavailable capability returns an explicit safe failure and never imitates success.
- A scanner failure, secret-class denial, policy deny, authorization deny or approval failure stops the flow before any sink.
- Product MemoryPolicy may deny more or require approval but can never authorize secret-class content or override scanner secret denial.
- Secret-class/provenance boundary is independent of pattern detection; arbitrary untyped free-text secret detection is not guaranteed.
- An audit failure is reported as a failure and never converted into a success.
- Forbidden shortcuts: hidden provider selection, paid fallback, writes before validation, retries without a finite limit, and cleanup omission.

## Checker guarantee (honest)

`scripts/verify-memory-isolation.mjs` confirms the structural order of known security calls inside
the single `executeMemoryWrite` function. It is target-specific and fail-closed on ambiguity, but it
is not a full interprocedural TypeScript control-flow proof. Dead helpers and other functions cannot
satisfy the order. Future pipeline changes must update the checker and its mutation self-tests.

Writing to MemoryPort before SensitiveDataScanner is forbidden. The sink accepts only the sealed
write contract with mandatory secret-boundary clearance produced by this pipeline.
