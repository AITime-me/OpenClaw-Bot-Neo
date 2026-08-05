# Neo Text Communication — Trust Boundaries and Threat Model

> **Build 3.7A — design only (corrective).** No claim that controls below are implemented in live
> runtime. **Build 3.7B** implements offline package-private principal/memory/policy contracts only.

Build 3.7B status: offline contracts implemented; live runtime absent.

Build 3.7E1 status: BLOCKED

Build 3.7F status: BLOCKED

Build 3.7B next stage: 3.7C

## 1. Trust boundaries

| Boundary | Trust posture |
|----------|---------------|
| Telegram / private mobile adapter | Untrusted network + DTO; emits bounded observations only. |
| Sealed transport-instance validation | Trusted local recognition of bot/app instance. |
| Atomic observed admission | Trusted ledger dedup before binding/principal. |
| Owner/conversation binding | Trusted allowlist → principal + canonical conversation. |
| `AuthenticatedCommunicationPrincipal` sealer | Core-only opaque capability; not exportable to adapters. |
| Memory authorization → `AuthenticatedMemoryAccess` | Separate capability family. |
| Orchestrator / FIFO / kill-switch snapshot | Trusted staging; no SDK types. |
| LLM adapter | Untrusted completion observation. |
| Outbound validation / outbox / delivery | Model output untrusted; sealed same-binding send only. |
| Connector / infrastructure platforms | **Out of text-turn trust graph**. |

## 2. Normative admission order (security-critical)

```text
NORMATIVE_ADMISSION_ORDER:
sealed transport validation
→ atomic observed admission
→ duplicate stop
→ owner binding
→ authenticated
→ accepted + conversationSequence
```

Creating `AuthenticatedCommunicationPrincipal` before atomic `observed` admission is forbidden.
Transport never mints trusted identities, `CommunicationIdempotencyKey`, `TurnId`, `CorrelationId`,
canonical `ConversationId`, or `observedAt`. Source timestamp is not ordering authority.

## 3. Threat model (text slice)

### Owner impersonation

Message text / favorable object literals never grant authority. Unknown sender → ignore or generic
deny. Binding runs only after fresh `observed` admission.

### Prompt injection

Fixed prompt sections; tools-free LLM port; recipient from sealed binding; kill switches from
immutable snapshot; tool-call-looking JSON is inert text.

### Secret leakage

Fail-closed sensitive-data scan before sinks; ledger/audit store digests/categories only;
credentials never in prompts.

### Replay / duplicate spend

Atomic unique `observed` insert before binding/LLM/delivery. Duplicate → existing outcome; no new
LLM; no new delivery.

### Delivery / checkpoint / audit partial failure

Orthogonal statuses. Delivered fact is retained when checkpoint or completion audit fails.
`CONVERSATION_CHECKPOINT_FAILED` pauses conversation; no LLM/delivery replay; idempotent
checkpoint reconciliation then optional idempotent audit retry.

### Crash mid-LLM / mid-delivery

`llm_started` without completion → `LLM_OUTCOME_UNKNOWN` (no automatic model retry; notice
forbidden). `delivery_started` without outcome → `DELIVERY_OUTCOME_UNKNOWN` (no automatic resend).

### Deterministic notice abuse

Notice forbidden on `LLM_OUTCOME_UNKNOWN` and when audit/delivery/scanner/ledger/config are unsafe.
Notice is not provider fallback and must not leak internals.

### Connector / tool escalation

Text composition must not import connector/infrastructure registries or tool executors. Builds
3.5B and 3.6B guarantees remain.

### Encryption / plaintext persistence

**Encryption live gate (BLOCKER for live):** no live Telegram/model route that persists
conversational content while `encryptionEnabled=false` (or until approved alternative). Offline
reference simulation may proceed. Encryption not implemented in 3.7A.

### Kill-switch bypass

Immutable snapshot at head-of-queue. LLM must not run when communication/LLM/delivery/audit/ledger/
scanner/required conversation state unavailable or config malformed. Audit start before LLM.

## 4. Kill switches and degraded modes

Snapshot fields: `ingressEnabled`, `communicationEnabled`, `llmEnabled`, `deliveryEnabled`,
`auditAvailable`, `textOnly` (true), route/fallback policy digest, limits/config version.

| Mode | Behavior |
|------|----------|
| Model known-unavailable / known timeout | Deterministic notice path only under notice rules |
| `LLM_OUTCOME_UNKNOWN` | No automatic model retry; notice forbidden |
| `DELIVERY_OUTCOME_UNKNOWN` | Pause/degrade; no automatic resend |
| `checkpointStatus=failed` after delivery | Pause/degrade; reconcile checkpoint only |
| Audit unavailable | Block LLM and delivery |
| Memory unavailable | Fail-closed when required; else omit excerpts per snapshot policy |

## 5. Error taxonomy (design)

`AUTH_REJECTED` · `AUTH_UNCERTAIN` · `INGRESS_DISABLED` · `COMMUNICATION_DISABLED` ·
`INVALID_OBSERVATION` · `PAYLOAD_TOO_LARGE` · `REPLAY` · `DUPLICATE_TRANSPORT_EVENT` ·
`QUEUE_FULL` · `LEDGER_UNAVAILABLE` · `CONVERSATION_STATE_UNAVAILABLE` ·
`CONVERSATION_CHECKPOINT_FAILED` · `AUDIT_UNAVAILABLE` · `SCANNER_UNAVAILABLE` ·
`MEMORY_UNAUTHORIZED` · `MEMORY_UNAVAILABLE` · `LLM_DISABLED` · `PROVIDER_UNAVAILABLE` ·
`LLM_TIMEOUT` · `LLM_CANCELLED` · `LLM_OUTCOME_UNKNOWN` · `INVALID_MODEL_RESPONSE` ·
`OUTPUT_REJECTED` · `RECIPIENT_DENIED` · `DELIVERY_DISABLED` · `DELIVERY_FAILED` ·
`DELIVERY_OUTCOME_UNKNOWN` · `AUDIT_FAILED` · `CONFIG_INVALID` ·
`ENCRYPTION_LIVE_GATE_BLOCKED` · `KILL_SWITCH`

## 6. Risks by severity

| Severity | ID | Risk | Design response |
|----------|----|------|-----------------|
| BLOCKER | TC-B01 | Live route with plaintext conversational persistence | Encryption live gate |
| BLOCKER | TC-B02 | Subscription route without E0 | Mandatory 3.7E0 |
| BLOCKER | TC-B03 | Collapsing communication/memory capabilities | Separate opaque families |
| HIGH | TC-H01 | Duplicate LLM on redelivery | Atomic observed admission before binding |
| HIGH | TC-H02 | Automatic resend on delivery uncertainty | `DELIVERY_OUTCOME_UNKNOWN` |
| HIGH | TC-H03 | Prompt injection enables tools/fallback | Tools-free port + isolation |
| HIGH | TC-H04 | Owner impersonation | Binding after observed only |
| HIGH | TC-H05 | Secret material in sinks | Scanner fail-closed |
| MEDIUM | TC-M01 | FIFO overflow | default 8; range 2..64; global pending |
| MEDIUM | TC-M02 | Source timestamp reordering | `conversationSequence` only |
| MEDIUM | TC-M03 | Markup abuse | Plain-text first Telegram adapter |
| MEDIUM | TC-M04 | Model summary as trusted memory | Untrusted / separate write process |
| MEDIUM | TC-M05 | Checkpoint failure after delivery | Orthogonal statuses; pause; no replay |
| LOW | TC-L01 | Persona tone drift | Shared VoiceProfile tags; not authority |

Historical closeout records for 3.5B/3.6B/R6 are **not** modified by this Build.

## Related documents

- [Architecture](text-architecture.md)
- [State machines](text-state-machines.md)
- [Implementation map](text-implementation-map.md)
