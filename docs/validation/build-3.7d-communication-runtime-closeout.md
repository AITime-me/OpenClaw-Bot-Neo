# Build 3.7D — Offline Executable Communication Runtime

Build 3.7D implements the package-private offline executable communication runtime on top of
contracts 3.7B / persistence 3.7C and contract delta 3.7D0. Fake LLM and fake delivery only.
No provider, Telegram, network, encryption, or production composition.

## Status

BEGIN_BUILD_3_7D_MARKERS
BUILD_ID: 3.7D
BUILD_KIND: OFFLINE_EXECUTABLE_RUNTIME
IMPLEMENTATION_STATUS: IMPLEMENTED
BUILD_3_7C_MODE: OFFLINE_ONLY
DURABLE_SQLITE_IMPLEMENTATION: PRESENT
LIVE_ENCRYPTION: NOT_IMPLEMENTED
EXECUTABLE_COMMUNICATION_RUNTIME: PRESENT
FAIL_SAFE_NO_RESUME_RECOVERY: TRUE
SQLITE_SCHEMA_VERSION: 1
FAKE_COMPLETION_ONLY: TRUE
PRODUCTION_COMPOSITION: ABSENT
PACKAGE_ROOT_EXPORTS: ABSENT
BUILD_3_7E1_STATUS: BLOCKED
BUILD_3_7F_STATUS: BLOCKED
PRODUCTION_READY: FALSE
SECURITY_APPROVED: FALSE
NEXT_STAGE: 3.7E1
END_BUILD_3_7D_MARKERS

## Implemented

- Contract delta 3.7D0: cancel transitions, `RECOVERY_CONTEXT_UNAVAILABLE`,
  `readDeliveryOutcome`, `recordCheckpointBarrier` / `barrier-active`, schema v1 unchanged
- Package-private `src/core/communication/application/**` orchestrator, FIFO dispatcher,
  recover / process-turn services, frozen reference queueConfig `{8, 64}`
- Package-private `src/communication/reference/**` fake LLM, fake delivery, identity binding,
  memory authorization broker, kill switch, `createReferenceTextSlice`
- Fail-safe no-resume restart recovery before ingress open
- Normative happy path: observation → idempotency → observed → binding → principal →
  authenticated → accepted → queued → audit start → memory → prompt → LLM → output validation →
  outbox → delivery → checkpoint → audit completion → completed
- Deterministic notices only for approved known LLM failures
- Cancellation / deadline / generation barriers; late promises cannot mutate durable outcomes
- `scripts/verify-communication-flow.mjs`, `check:communication-flow`, AST/dependency-cruiser
  rules, negative fixtures
- Focused behavioral + record tests
- Corrective package (honest, on top of 529e51d then c93aace): exclusive in-process runtime
  ownership; verified queueConfig 8/64; checkpoint failure after delivery; barrier/gate before
  memory/LLM; paginated recovery with unchanged-page fail-closed; ledger checkpointStatus-first
  barrier rules; trusted FIFO; post-start abort/deadline latch; read-only outbox lookup; mandatory
  completion audit before completed; typed phase outcomes (unavailable/stale/conflict fail-closed)

## Still absent

- Provider / OpenAI / Codex / OpenClaw integration
- Telegram adapter and live delivery
- OAuth, credentials, network/model calls
- Encryption implementation
- Production composition and semantic-memory writes from communication runtime
- Durable work-envelope resume / principal rehydration / automatic unpause / automatic retry-resend
- Package-root / host barrel exports of communication runtime
- Build 3.7E1 and Build 3.7F remain **BLOCKED**

## Next stage

Build **3.7E1** remains blocked pending capability probe and live gates.

Build 3.7D mode: OFFLINE_ONLY

Build 3.7E1 status: BLOCKED

Build 3.7F status: BLOCKED

Build 3.7D next stage: 3.7E1
