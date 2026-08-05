# Build 3.7D0 — Communication Runtime Decisions

Build 3.7D0 records the **contract delta** required before the offline executable
communication runtime (Build 3.7D). It freezes fail-safe restart recovery, terminal
cancel transitions, read-only outbox outcome lookup, and the durable checkpoint barrier.
No provider, Telegram, encryption, production composition, or schema bump.

## Status

BEGIN_BUILD_3_7D0_MARKERS
BUILD_ID: 3.7D0
BUILD_KIND: RUNTIME_DECISIONS_CONTRACT
IMPLEMENTATION_STATUS: CONTRACTS_ONLY
BUILD_3_7C_MODE: OFFLINE_ONLY
DURABLE_SQLITE_IMPLEMENTATION: PRESENT
LIVE_ENCRYPTION: NOT_IMPLEMENTED
EXECUTABLE_COMMUNICATION_RUNTIME: ABSENT
PRODUCTION_COMPOSITION: ABSENT
PACKAGE_ROOT_EXPORTS: ABSENT
FAIL_SAFE_NO_RESUME_RECOVERY: REQUIRED
SQLITE_SCHEMA_VERSION: 1
FAKE_COMPLETION_ONLY: REQUIRED
BUILD_3_7E1_STATUS: BLOCKED
BUILD_3_7F_STATUS: BLOCKED
PRODUCTION_READY: FALSE
SECURITY_APPROVED: FALSE
NEXT_STAGE: 3.7D_IMPLEMENTATION
END_BUILD_3_7D0_MARKERS

## Decision 1 — Fail-safe no-resume recovery

Restart recovery remains fail-safe. A recovery candidate is **not** authority.

After restart it is forbidden to restore:

- principal;
- input/work envelope;
- admission evidence;
- ValidatedTextOutput;
- recipient or payload authority.

Unfinished pre-delivery turns are safely cancelled/completed without LLM, notice, or delivery.

`llm_started` without durable result → `LLM_OUTCOME_UNKNOWN`; no retry; no notice; no delivery.

`delivery_started` → read only authoritative outbox outcome; restore delivered / known-failure /
outcome-unknown as durable fact; not-recorded / not-found → durable delivery-outcome-unknown;
never resend.

Ingress opens only after successful classification and durable fixation of all recovery candidates.
A recovery error leaves ingress disabled.

## Decision 2 — Terminal cancel transitions

Legal cancel targets:

- observed → cancelled
- authenticated → cancelled
- accepted → cancelled
- queued → cancelled (existing)
- llm_started → cancelled (existing)
- llm_completed → cancelled
- deterministic_notice_prepared → cancelled
- output_validated → cancelled

After cancelled: cancelled → completed.

`delivery_started → cancelled` remains **illegal**.

New error code: `RECOVERY_CONTEXT_UNAVAILABLE`.

## Decision 3 — Read-only outbox outcome lookup

`CommunicationDeliveryOutboxPort.readDeliveryOutcome(...)` returns:

- delivered
- known-failure
- outcome-unknown
- not-recorded
- not-found
- unavailable

Lookup must not return payload, digest, recipient, principal, or capability, and must not allow resend.

SQLite schema version remains **1** (no migration / bump).

## Decision 4 — Durable checkpoint barrier

`ConversationStatePort.recordCheckpointBarrier(...)` reasons:

- checkpoint-failed
- llm-outcome-unknown
- delivery-outcome-unknown
- recovery-context-unavailable-after-delivery

Barrier behavior:

- CAS on revision; revision +1;
- pause_state=degraded; checkpoint_status=failed;
- context and summary byte-equivalent;
- idempotent;
- protective empty snapshot when none exists;
- no LLM, delivery, audit, or memory side effects.

Ordinary `checkpoint` while an active barrier is present returns `barrier-active`.

Only explicit `reconcileCheckpoint` may move pending/failed → succeeded. Pause stays degraded;
automatic unpause is forbidden.

## Decision 5 — Offline runtime constraints for 3.7D

Reference composition must pass explicit frozen queueConfig `{ maxDepthPerConversation: 8,
maxGlobalPending: 64 }` to both SQLite factory and dispatcher. Default `maxGlobalPending=1` must
not be used for reference.

Fake LLM / fake delivery only. No network, provider SDK, Telegram, OAuth, encryption, production
composition, semantic-memory writes, or package-root exports.

## Next stage

Build **3.7D** implements the offline executable orchestrator and reference adapters against these
decisions.
