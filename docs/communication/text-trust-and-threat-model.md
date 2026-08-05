# Neo Text Communication — Trust Boundaries and Threat Model

> **Build 3.7A — design only.** No claim that controls below are implemented. Verified facts refer
> only to existing memory/connector/infra foundations unless stated otherwise.

## 1. Trust boundaries

| Boundary | Trust posture |
|----------|---------------|
| Telegram / mobile transport adapter | Untrusted network + untrusted DTO; emits bounded observations only. |
| Transport-instance validation | Trusted local config: which bot/app instance is recognized. |
| Owner/conversation binding | Trusted allowlist maps external sender/conversation refs → owner + canonical conversation. |
| `AuthenticatedCommunicationPrincipal` sealer | Trusted core-only; WeakMap (or equivalent opaque) membership; not exportable to adapters. |
| Communication application / orchestrator | Trusted staging order; no SDK types. |
| Ephemeral context window | Process-local; untrusted content labels preserved. |
| `ConversationStatePort` / turn ledger / audit | Durable trusted metadata stores; content policy differs by store. |
| Memory authorization → `AuthenticatedMemoryAccess` | Separate capability; reuse existing memory seal semantics. |
| `LlmCompletionPort` adapter | Untrusted completion observation. |
| Outbound validation | Treats model output as untrusted. |
| Delivery adapter | Executes sealed same-binding send only. |
| Connector / infrastructure platforms | **Out of text-turn trust graph**; must remain unreachable. |

Channel adapters never receive communication or memory sealers.

## 2. Threat model (text slice)

### Owner impersonation

**Threat:** attacker sets `ownerId` / authority in message text or forges a favorable object literal
as “authenticated principal”.

**Design control:** identities and capabilities are assigned only by trusted binding + opaque
sealers. Message text and ordinary objects are never authority. Unknown Telegram/mobile sender →
ignore or generic deny without internal detail disclosure.

### Prompt injection

**Threat:** owner or retrieved memory text attempts to override policy, enable tools, change
recipient, disable audit, or activate paid API fallback.

**Design control:** fixed prompt section order; policy/persona immutable relative to later
sections; tools/functions absent from LLM port; recipient from sealed binding only; kill switches
from immutable snapshot, not model text; tool-call-looking JSON is inert text.

### Secret leakage

**Threat:** bot tokens, API keys, session material, or secret memory fields reach LLM, audit,
logs, or delivery.

**Design control:** fail-closed sensitive-data scan before sinks; ledger/audit store digests and
categories only; credentials never in prompts; existing scanner already classifies Telegram bot
tokens for memory paths — communication paths must apply the same fail-closed posture when
implemented.

### Replay / duplicate spend

**Threat:** Telegram redelivery causes a second LLM call and second user-visible reply.

**Design control:** durable `CommunicationTurnLedgerPort` atomic unique admission before LLM.
Ephemeral replay is allowed **only** for offline reference simulation, not for live.

### Delivery uncertainty abuse / duplicates

**Threat:** automatic resend after uncertain delivery creates duplicates; treating unknown as
failure hides delivered messages.

**Design control:** `DELIVERY_OUTCOME_UNKNOWN` forbids automatic resend; not success; durable;
conversation paused/degraded; requires reconciliation. Exactly-once delivery is **not** promised
without provider reconciliation.

### Crash mid-LLM / mid-delivery

**Threat:** restart re-invokes LLM or re-sends after partial progress.

**Design control:** `llm_started` without completion → `LLM_OUTCOME_UNKNOWN` (no automatic model
retry); `delivery_started` without outcome → `DELIVERY_OUTCOME_UNKNOWN` (no automatic resend).
`accepted`/`queued` may resume.

### Connector / tool escalation

**Threat:** text agent gains connector registries, infrastructure ops, shell, deploy, secret readers.

**Design control:** text communication composition must not import connector/infrastructure
registries or tool executors. Builds 3.5B and 3.6B guarantees remain. Model cannot enable them via
prompt.

### Encryption / plaintext persistence

**Threat:** live Telegram/model route persists conversational plaintext while `encryptionEnabled=false`.

**Design control — encryption live gate (BLOCKER for live):**

- No claim of encryption at rest today (`encryptionEnabled=false` verified invariant).
- Durable ledger stores only safe metadata and digests.
- Outbox and conversation checkpoints **may** contain conversational content.
- Live Telegram/model route is **forbidden** until such content is protected by encryption at rest
  **or** another approved design that excludes plaintext content storage.
- Offline reference simulation may proceed without encryption.
- Build 3.7A does **not** implement encryption.

### Kill-switch bypass

**Threat:** model or malformed config continues LLM/delivery while disabled.

**Design control:** immutable validated snapshot at head-of-queue turn. LLM must not run when
communication, LLM, delivery, audit, ledger, scanner, required conversation state are unavailable,
or config is malformed.

## 3. Kill switches and degraded modes

Immutable snapshot fields (design):

- `ingressEnabled`
- `communicationEnabled`
- `llmEnabled`
- `deliveryEnabled`
- `auditAvailable`
- `textOnly` (slice invariant: true)
- route/fallback policy digest
- limits / config version

Degraded modes (honest):

| Mode | Behavior |
|------|----------|
| Memory unavailable | Continue without memory excerpts or fail-closed per snapshot policy (implementation chooses fail-closed when memory was required). |
| Model unavailable | Deterministic system notice only under notice rules; no API/paid fallback. |
| Known LLM timeout | Same as unavailable for notice eligibility; distinct outcome code. |
| `LLM_OUTCOME_UNKNOWN` | No automatic model retry; durable record. |
| Telegram/mobile unavailable | Delivery failure / unknown; no fake success. |
| Audit unavailable | Block LLM and delivery (two-phase rule). |
| `DELIVERY_OUTCOME_UNKNOWN` | Pause/degrade conversation; no automatic resend. |

## 4. Error taxonomy (design)

Representative codes:

`AUTH_REJECTED` · `AUTH_UNCERTAIN` · `INGRESS_DISABLED` · `COMMUNICATION_DISABLED` ·
`INVALID_OBSERVATION` · `PAYLOAD_TOO_LARGE` · `REPLAY` · `DUPLICATE_TRANSPORT_EVENT` ·
`QUEUE_FULL` · `LEDGER_UNAVAILABLE` · `CONVERSATION_STATE_UNAVAILABLE` · `AUDIT_UNAVAILABLE` ·
`SCANNER_UNAVAILABLE` · `MEMORY_UNAUTHORIZED` · `MEMORY_UNAVAILABLE` · `LLM_DISABLED` ·
`PROVIDER_UNAVAILABLE` · `LLM_TIMEOUT` · `LLM_CANCELLED` · `LLM_OUTCOME_UNKNOWN` ·
`INVALID_MODEL_RESPONSE` · `OUTPUT_REJECTED` · `RECIPIENT_DENIED` · `DELIVERY_DISABLED` ·
`DELIVERY_FAILED` · `DELIVERY_OUTCOME_UNKNOWN` · `AUDIT_FAILED` · `CONFIG_INVALID` ·
`ENCRYPTION_LIVE_GATE_BLOCKED` · `KILL_SWITCH`

Two-phase audit integrity: if delivery confirmed but completion audit fails → `delivered=true`,
`auditStatus=failed`. Delivered must not be rewritten as undelivered. Idempotent audit completion
retry is allowed; delivery retry is not automatic.

## 5. Risks by severity

| Severity | ID | Risk | Design response |
|----------|----|------|-----------------|
| BLOCKER | TC-B01 | Live route with plaintext conversational persistence while encryption absent | Encryption live gate; forbid live Telegram/model until resolved |
| BLOCKER | TC-B02 | Subscription route assumed workable without E0 evidence | Mandatory 3.7E0 before large B–D live spend |
| BLOCKER | TC-B03 | Collapsing communication principal into memory auth or message fields | Separate opaque capability families |
| HIGH | TC-H01 | Duplicate LLM on transport redelivery | Durable atomic ledger admission |
| HIGH | TC-H02 | Automatic resend on delivery uncertainty | `DELIVERY_OUTCOME_UNKNOWN` semantics |
| HIGH | TC-H03 | Prompt injection enables tools/connectors/fallback | Tools-free port + isolation + immutable snapshot |
| HIGH | TC-H04 | Owner impersonation via text/object literal | Trusted binding + opaque seal only |
| HIGH | TC-H05 | Secret material in prompt/audit/ledger | Scanner fail-closed; content-free ledger/audit |
| MEDIUM | TC-M01 | FIFO overflow DoS | Bounded depth 2..64; `QUEUE_FULL`; global pending cap |
| MEDIUM | TC-M02 | Source timestamp reordering | Order by trusted `conversationSequence` only |
| MEDIUM | TC-M03 | Markdown/HTML mention abuse on Telegram | Plain-text-only first adapter |
| MEDIUM | TC-M04 | Treating model summary as trusted memory | Explicit untrusted / separate write process |
| LOW | TC-L01 | Persona tone drift | Shared style tags with VoiceProfile; persona ≠ authority |
| LOW | TC-L02 | Doc/code envelope drift | Implementation map locks future TS names |

Historical closeout records for 3.5B/3.6B and R6 items are **not** modified by this Build.

## Related documents

- [Architecture](text-architecture.md)
- [State machines](text-state-machines.md)
- [Implementation map](text-implementation-map.md)
