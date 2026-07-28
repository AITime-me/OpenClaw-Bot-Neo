# Document pipeline

## Input

TXT, Markdown, PDF or DOCX assets.

## Ordered flow

1. Validate type by content, limits and decompression policy.
2. Disable macros and embedded code execution.
3. Extract text safely and mark it untrusted.
4. Run SensitiveDataScanner before any sink.
5. Chunk large documents with provenance.
6. Analyze one or multiple documents without automatic memory write.
7. Clean raw files after completion or failure.

## Invariants

- Policy gates run before side effects; approval gates cannot be bypassed.
- Every job has an idempotency key, explicit timeout and cancellation signal.
- Cancellation stops downstream work; failure and cancellation both trigger cleanup.
- Audit stores provenance, policy decisions, provider class and redacted errors, never raw secrets or content.
- An unavailable capability returns an explicit safe failure and never imitates success.
- Forbidden shortcuts: hidden provider selection, paid fallback, writes before validation, retries without a finite limit, and cleanup omission.
