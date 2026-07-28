# Reminder pipeline

## Input

Reminder draft with timezone, expiry and idempotency key.

## Ordered flow

1. Validate timezone and schedule without host-timezone defaults.
2. Check idempotency and reject duplicates.
3. Apply notification policy and quiet hours.
4. Request approval for schedule changes.
5. Create through ReminderPort without payment actions.
6. Deliver only while current and record acknowledgement.

## Invariants

- Policy gates run before side effects; approval gates cannot be bypassed.
- Every job has an idempotency key, explicit timeout and cancellation signal.
- Cancellation stops downstream work; failure and cancellation both trigger cleanup.
- Audit stores provenance, policy decisions, provider class and redacted errors, never raw secrets or content.
- An unavailable capability returns an explicit safe failure and never imitates success.
- Forbidden shortcuts: hidden provider selection, paid fallback, writes before validation, retries without a finite limit, and cleanup omission.
