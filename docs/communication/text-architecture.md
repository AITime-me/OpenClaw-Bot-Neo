# Neo Text Communication Vertical Slice — Architecture Design

> **Build 3.7A — design only (corrective).** This document fixes target architecture for the first
> owner-only text communication contour. It does **not** claim implementation, live Telegram, live
> LLM route, production readiness, or security approval.
>
> Verified foundation baseline: Build 3.6B integrated; Build 3.7A design base `b662376`.
> Text communication runtime code is **absent**.

## 1. Executive design

Neo is an owner-only personal assistant with a masculine persona (calm, intelligent, confident,
restrained, slightly futuristic; not call-center cheerful). Persona is presentation only and is
**not** a security authority.

The first communication vertical slice is text-only. Temporary Telegram adapter **or** future
private mobile messenger adapter feed the same channel-independent communication core.

### Status separation (mandatory)

| Kind | Meaning in this document |
|------|--------------------------|
| **Verified fact** | Exists in current repository code/tests/closeouts. |
| **Target architecture** | Normative design for upcoming implementation Builds 3.7B–F. |
| **Unresolved hypothesis** | Live operational approval for continuous owner-only subscription use remains
  `UNRESOLVED` after Build 3.7E0; technical ChatGPT OAuth route is `PASS`. |

## 2. Telegram temporary / mobile final

| Role | Design |
|------|--------|
| Telegram | **Temporary** app-private transport adapter only. |
| Final UI | Owner-only private mobile app / closed messenger. |
| Core independence | Communication core must not import Telegram SDK types. |

Telegram must be removable and replaceable by a mobile adapter **without rewriting** canonical
conversation, conversation state, semantic memory, LLM routing, communication orchestration, or
security policy. Both adapters are **peer adapters** on the same core.

## 3. Target architecture overview

```text
Transport adapter (Telegram | private mobile)     [app-private]
        │ untrusted bounded observation only
        ▼
Trusted ingress + sealed transport-instance check
        ▼
CommunicationTurnLedgerPort: atomic observed admission
        ▼
Owner/conversation binding → AuthenticatedCommunicationPrincipal
        ▼
authenticated → accepted (+ conversationSequence) → queued
        ▼
Immutable kill-switch snapshot + two-phase audit start
        ▼
Context + separately authorized read-only memory
        ▼
LlmCompletionPort (tools-free) OR deterministic notice path
        ▼
Output validation → encrypted-before-live outbox → sealed delivery
        ▼
Orthogonal deliveryStatus / checkpointStatus / auditStatus → completed
```

## 4. Identities and capabilities

### Transport may provide only untrusted observations

After structural parse (raw SDK DTO stays inside the adapter):

- transport instance reference;
- external message reference;
- external conversation reference;
- external sender reference;
- optional source timestamp (metadata only; **not** ordering; does **not** replace `observedAt`);
- raw text.

Transport **must not** create: `TurnId`, `CorrelationId`, canonical `ConversationId`,
`CommunicationIdempotencyKey`, `observedAt`, `OwnerId`, `ActorId`, or authority.

### Two opaque capability families (non-interchangeable)

| Capability | Purpose |
|------------|---------|
| `AuthenticatedCommunicationPrincipal` | Communication binding for the turn. |
| `AuthenticatedMemoryAccess` | Separately authorized bounded **read-only** memory access. |

Ordinary object literal / spread / JSON / prototype clone cannot forge either capability. Channel
adapters do **not** receive sealers.

**Normative rule:** principal is created **only after** atomic `observed` ledger admission and only
for a fresh observed turn. Principal is never created before atomic observed admission.

## 5. Normative admission order (final)

Stable marker block — identical across architecture, state machines, trust model, implementation
map, and closeout:

```text
NORMATIVE_ADMISSION_ORDER:
sealed transport validation
→ atomic observed admission
→ duplicate stop
→ owner binding
→ authenticated
→ accepted + conversationSequence
```

Expanded steps:

1. Transport adapter structurally parses raw SDK DTO → channel-independent untrusted observation.
2. Trusted ingress verifies sealed transport-instance capability.
3. Bounds and canonical form of external transport references are checked.
4. Trusted clock creates local `observedAt`.
5. Locally derive transport-scoped `CommunicationIdempotencyKey` from:
   - trusted transport instance identity;
   - canonical external conversation reference;
   - canonical external message reference;
   - binding/schema version.
6. Locally create `TurnId` for the observed record.
7. `CommunicationTurnLedgerPort` performs **atomic unique insert** with `state = observed`.
8. On unique conflict: return existing `TurnId`/outcome; do **not** re-bind owner into a new turn;
   forbid new LLM invocation; forbid new delivery (**duplicate stop**).
9. Only for a **fresh** observed turn: perform exact owner/conversation binding.
10. Binding failure: `observed → authentication_rejected`.
11. Binding success: create opaque `AuthenticatedCommunicationPrincipal`; resolve canonical
    `ConversationId`; create `CorrelationId`; transition `observed → authenticated`.
12. Atomic conversation admission: `authenticated → accepted` with trusted monotonic
    `conversationSequence`.
13. Then: `accepted → queued`.

### Ledger responsibility split

`CommunicationTurnLedgerPort` design **must** separate:

1. atomic transport-event observation / deduplication (`observed` insert);
2. authentication transition (`authenticated` / `authentication_rejected`);
3. atomic conversation admission / sequence assignment (`accepted` + `conversationSequence`).

## 6. Post-queue pipeline

After `queued` and head-of-queue selection:

1. Freeze immutable kill-switch / limits / route-digest snapshot.
2. Two-phase audit: durable turn-start **before** any LLM or delivery (`audit start before LLM`).
3. Load ephemeral context + durable conversation checkpoint metadata.
4. Optionally derive separately authorized read-only `AuthenticatedMemoryAccess`.
5. Assemble prompt (fixed section order §8).
6. Invoke tools-free `LlmCompletionPort` **or** follow deterministic notice path (§9) for known LLM
   failures only.
7. Validate outbound text; place payload in short-lived outbox (encryption live gate for live).
8. Deliver only to sealed same-binding recipient.
9. Persist orthogonal factual statuses; attempt conversation checkpoint; completion audit.
10. Never automatic model replay after `LLM_OUTCOME_UNKNOWN`; never automatic resend after
    `DELIVERY_OUTCOME_UNKNOWN`.

## 7. Orthogonal factual statuses

Turn completion uses orthogonal fields — not a single boolean success:

| Field | Meaning |
|-------|---------|
| `deliveryStatus` | `delivered` \| `delivery_failed` \| `delivery_outcome_unknown` \| unset/pre-delivery |
| `checkpointStatus` | `succeeded` \| `failed` \| `pending` |
| `auditStatus` | `succeeded` \| `failed` \| `pending` |

### Checkpoint partial failure after delivery

When delivery is confirmed but conversation checkpoint write fails:

- `deliveryStatus=delivered` is retained forever as the factual outcome;
- `checkpointStatus=failed`;
- conversation enters **paused/degraded**;
- next ordinary turn must **not** execute on stale context;
- only idempotent checkpoint reconciliation is allowed;
- after checkpoint reconciliation, idempotent completion-audit retry is allowed;
- LLM is **not** re-invoked;
- delivery is **not** re-executed;
- delivered reply is **never** rewritten to failure/not-delivered;
- completion audit, when available, must honestly record checkpoint failure;
- error category: `CONVERSATION_CHECKPOINT_FAILED`.

### Meaning of terminal `completed`

`completed` means primary turn processing has terminated and factual outcomes have been recorded.
It does **not** mean delivery succeeded, checkpoint succeeded, or completion audit succeeded.
Final facts are the orthogonal status fields.

If delivered but completion audit fails: `deliveryStatus=delivered`, `auditStatus=failed`.

## 8. Prompt model

Fixed section order:

1. Immutable system security policy.
2. Neo persona (not authority).
3. Memory excerpts with provenance/trust labels.
4. Conversation context as untrusted contextual material.
5. Current owner text as untrusted input.

## 9. LLM and deterministic system notices

Provider-independent tools-free `LlmCompletionPort`: bounded I/O, timeout, cancellation; outcomes
include provider unavailable, known timeout, cancelled, invalid response, outcome unknown. No tools,
functions, connector/infrastructure registries, shell, or arbitrary recipient.

### Deterministic notice (not a model response)

Legal path:

```text
llm_started
→ llm_known_failed
→ deterministic_notice_prepared
→ output_validated
→ delivery_started
→ delivered | delivery_failed | delivery_outcome_unknown
→ completed
```

Allowed only for **known** outcomes (e.g. provider unavailable, known timeout, known cancellation
before result when policy permits).

**Forbidden** when: `LLM_OUTCOME_UNKNOWN` (deterministic notice is **forbidden** on
`LLM_OUTCOME_UNKNOWN`); uncertain timeout/cancellation outcome; audit failure;
delivery disabled; scanner unavailable; ledger unavailable; malformed config.

Notice must pass the same output validation, secret/sensitive scan, short-lived outbox, sealed
same-binding recipient, `delivery_started`, delivery uncertainty taxonomy, and completion audit.
Notice is not a model response, not API/provider fallback, not dynamically model-generated, and
must not disclose internal provider/security details.

## 10. Delivery, FIFO, encryption

- First Telegram adapter: plain text only (no Markdown/HTML parse mode).
- Recipient only from sealed canonical conversation binding.
- Exactly-once delivery is **not** claimed.
- FIFO: one active turn per canonical conversation; `maxDepthPerConversation` **default = 8**;
  schema range **2..64**; `maxGlobalPending` required and bounded; unlimited queue forbidden;
  order by `conversationSequence` only.
- Encryption live gate: live Telegram/model routes that persist conversational content are blocked
  while `encryptionEnabled=false` (or until an approved alternative). Offline reference simulation
  may proceed. Encryption is not implemented in 3.7A.

## 11. Subscription route — Build 3.7E0 (closed research)

Build 3.7E0 closed the official-source feasibility research:

- `TECHNICAL_SUBSCRIPTION_ROUTE: PASS` — ChatGPT OAuth route exists and remains Neo’s primary
  candidate;
- `LIVE_OPERATIONAL_APPROVAL: UNRESOLVED` — not production/live approved;
- `RESEARCH_EXECUTIVE_VERDICT: FAIL_UNDER_ABSOLUTE_ZERO_PAID_FALLBACK_CRITERION` — absolute
  zero-additional-spend (including already-held ChatGPT credits) was not met by the strict research
  criterion;
- API-key / token-billed Platform API / silent fallback remain forbidden;
- Builds 3.7B–D allowed offline/reference only; 3.7E1 and 3.7F blocked;
- next implementation stage: **3.7B**.

See [3.7E0 closeout](../validation/build-3.7e0-subscription-route-feasibility.md).

## 12. Public / private API

Communication contracts live under package-private `src/core/communication/**` and are **not**
added to root-reachable wildcard barrels (`src/core/domain/index.ts`, `src/core/ports/index.ts`,
etc.). `src/index.ts` currently wildcard-exports those barrels; therefore communication modules
must not be re-exported through them without a separate public API review and proven external
consumer. App-private adapters, sealers, SQLite ports, and composition roots stay out of package
root.

## 13. Implementation sequence

1. **3.7A** — design documentation (closed; integrated).
2. **3.7E0** — subscription route feasibility (closed research; this outcome).
3. **3.7B** — package-private domain/ports/policies (**next**; offline only).
4. **3.7C** — durable SQLite communication foundation (offline only).
5. **3.7D** — orchestrator + offline reference / fake completion.
6. **3.7E1** — Codex/OpenClaw route **blocked** pending capability probe and live gates.
7. **3.7F** — temporary Telegram adapter **blocked** pending E1, encryption, operational approval.
8. Later: files/images → voice → masculine TTS → plans/reminders → private mobile → Telegram
   removal → read-only eyes → safe hands.

## 14. Future diagnostics (absent in 3.7A)

Not created in this Build: `textCommunicationProductionReady`, `telegramAdapterActivated`,
`llmProviderActivated`, `oauthSessionConfigured`, `durableReplayStore`,
`durableCommunicationAudit`, `connectorToolsAttachedToTextAgent`, `openClawRuntimeIntegrated`.

Existing invariants remain false/disabled: `deploymentReady`, `securityApprovalComplete`,
`secretProviderConfigured`, `encryptionEnabled`, `durableApprovalPort`, `durableAuditPort`,
`networkIsolationEnforced`, `apiFallbackEnabled`, `paidFallbackEnabled`.

## Related documents

- [Trust and threat model](text-trust-and-threat-model.md)
- [State machines](text-state-machines.md)
- [Implementation map](text-implementation-map.md)
- [Build 3.7A closeout](../validation/build-3.7a-text-communication-design-closeout.md)
