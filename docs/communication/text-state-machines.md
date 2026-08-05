# Neo Text Communication — State Machines

> **Build 3.7A — design only (corrective).** Machines below are normative for future
> implementation. **Build 3.7B** implements `LEGAL_TRANSITIONS` and related domain contracts offline;
> durable ledger storage remains absent.

Build 3.7B status: offline contracts implemented; live runtime absent.

Build 3.7E1 status: BLOCKED

Build 3.7F status: BLOCKED

Build 3.7B next stage: 3.7C

## 1. Durable turn ledger states

Minimum states:

`observed` · `authentication_rejected` · `authenticated` · `accepted` · `queued` ·
`llm_started` · `llm_completed` · `llm_known_failed` · `deterministic_notice_prepared` ·
`output_validated` · `delivery_started` · `delivered` · `delivery_failed` ·
`delivery_outcome_unknown` · `cancelled` · `completed`

### Normative admission order (pre-queue)

```text
NORMATIVE_ADMISSION_ORDER:
sealed transport validation
→ atomic observed admission
→ duplicate stop
→ owner binding
→ authenticated
→ accepted + conversationSequence
```

Then: `accepted → queued`.

### Model-response happy path

```text
queued
  → llm_started
  → llm_completed
  → output_validated
  → delivery_started
  → delivered | delivery_failed | delivery_outcome_unknown
  → completed
```

### Deterministic system notice legal path

```text
llm_started
→ llm_known_failed
→ deterministic_notice_prepared
→ output_validated
→ delivery_started
→ delivered | delivery_failed | delivery_outcome_unknown
→ completed
```

Authentication failure: `observed → authentication_rejected`.

## 2. Ledger responsibility split

| Phase | Ledger duty |
|-------|-------------|
| Observation / dedup | Atomic unique insert at `observed` keyed by `CommunicationIdempotencyKey` |
| Authentication | `observed → authenticated` or `observed → authentication_rejected` |
| Conversation admission | `authenticated → accepted` + assign monotonic `conversationSequence` |

Principal creation is allowed only on the authentication success transition after fresh `observed`
admission — never before atomic observed admission.

## 3. Legal vs illegal transitions

**Legal (representative):**

| From | To | Condition |
|------|----|-----------|
| (ingress) | observed | atomic unique insert success |
| observed | authenticated | owner/conversation binding success; principal sealed |
| observed | authentication_rejected | binding failure / uncertain deny |
| authenticated | accepted | atomic conversation admission + `conversationSequence` |
| accepted | queued | FIFO accept under depth/global limits |
| queued | llm_started | snapshot allows LLM; audit start recorded |
| llm_started | llm_completed | provider returned bounded completion |
| llm_started | llm_known_failed | known failure (notice-eligible or notice-ineligible) |
| llm_known_failed | deterministic_notice_prepared | notice-eligible only: unavailable / timeout / cancel-before-result |
| llm_known_failed | completed | notice-ineligible known failures: policy-rejected / invalid-response (no delivery) |
| llm_completed | output_validated | outbound checks pass |
| deterministic_notice_prepared | output_validated | same outbound checks + scans |
| output_validated | delivery_started | delivery enabled; outbox accepted |
| delivery_started | delivered | provider ack success |
| delivery_started | delivery_failed | known failure |
| delivery_started | delivery_outcome_unknown | uncertainty |
| delivered / delivery_failed / delivery_outcome_unknown / cancelled / authentication_rejected | completed | primary processing terminated; factual statuses recorded |

**Illegal (representative):**

- principal / binding before atomic `observed` admission
- `observed → llm_started` (skips auth/admission/audit-start)
- second fresh turn for duplicate `CommunicationIdempotencyKey`
- `llm_completed → llm_started` automatic retry after `LLM_OUTCOME_UNKNOWN`
- `llm_started → deterministic_notice_prepared` when outcome is unknown
- `llm_known_failed → delivery_started` (notice-ineligible failures must not deliver)
- notice preparation for `policy-rejected` / `invalid-response` / `outcome-unknown`
- `delivery_outcome_unknown → delivery_started` automatic resend
- `delivered → delivery_failed` rewrite after success
- any transition that enables tools/connectors from model output

## 4. Restart recovery

| Prior durable state | After restart |
|---------------------|---------------|
| `accepted` / `queued` | May restore and continue under current kill-switch snapshot. |
| `llm_started` without completion | Record `LLM_OUTCOME_UNKNOWN`; **no automatic** model re-invoke; deterministic notice **forbidden**. |
| `llm_known_failed` | Notice-eligible → may continue notice/delivery; notice-ineligible → complete without delivery; no LLM re-invoke. |
| `deterministic_notice_prepared` | May continue notice/delivery path if statuses allow; no LLM re-invoke. |
| `delivery_started` without outcome | Record `DELIVERY_OUTCOME_UNKNOWN`; **no automatic** resend. |
| `delivered` + `checkpointStatus=failed` | Keep delivered; reconcile checkpoint only; no LLM/delivery replay. |
| `delivered` | Remains delivered; idempotent completion-audit retry allowed. |
| Ephemeral-only simulation store | Lost; offline reference simulation only. |

## 5. Duplicate / replay

- `CommunicationIdempotencyKey` derived locally after sealed transport validation (never by transport).
- Atomic unique `observed` insert: conflict → duplicate stop (return existing TurnId/outcome).
- Ephemeral replay maps are **not** sufficient for live.

## 6. FIFO and ordering

- One active turn per canonical conversation.
- Order by trusted monotonic `conversationSequence` only (source timestamp never orders).
- `maxDepthPerConversation` **default = 8**; schema range **2..64**; unlimited forbidden.
- `maxGlobalPending` required and bounded.
- Overflow → `QUEUE_FULL`.

## 7. LLM outcome unknown

- Not success; durable; forbids automatic model replay.
- Deterministic notice **forbidden**.
- May leave conversation degraded until policy resolves.

## 8. Delivery outcome unknown

- Not success; not known failure; forbids automatic resend; durable; pauses/degrades conversation.
- Requires reconciliation or explicit owner/operator resolution.
- Exactly-once delivery is not promised without provider reconciliation.

## 9. Orthogonal statuses and `completed`

```text
deliveryStatus | checkpointStatus | auditStatus
```

Terminal `completed` means primary turn processing terminated and factual outcomes were recorded.
It does **not** require successful delivery, checkpoint, or completion audit.

### Checkpoint partial failure after delivery

- `deliveryStatus=delivered` retained forever;
- `checkpointStatus=failed`;
- conversation paused/degraded;
- no ordinary next turn on stale context;
- idempotent checkpoint reconciliation only;
- then idempotent completion-audit retry;
- no LLM re-call; no delivery resend;
- delivered fact never rewritten to not-delivered;
- error category `CONVERSATION_CHECKPOINT_FAILED`.

### Audit partial failure after delivery

- `deliveryStatus=delivered` retained;
- `auditStatus=failed`;
- idempotent completion-audit retry allowed;
- delivery not automatically retried.

## 10. Two-phase audit

**Phase A:** audit available + durable turn-start written **before** LLM/delivery.
**Phase B:** completion event records factual LLM/delivery/checkpoint/audit statuses.

## 11. Deterministic notice constraints

Allowed only for **notice-eligible** known LLM failures (provider / quota unavailable, known timeout,
cancelled-before-invocation) when audit, delivery, scanner, and ledger are available and config is
valid. Must traverse `output_validated` → `delivery_started` → delivery taxonomy → `completed`.
Notice-ineligible known failures (`policy-rejected`, `invalid-response`) complete without notice or
delivery. Outcome-unknown must not receive a notice. Not a model response; not API/provider fallback.

## 12. Conversation pause / reconciliation

Triggers: `DELIVERY_OUTCOME_UNKNOWN`, unresolved `LLM_OUTCOME_UNKNOWN`,
`checkpointStatus=failed`, encryption live gate, malformed config, audit/ledger unavailability.

Resume: explicit future reconciliation — never silent automatic resend of uncertain deliveries.

## Related documents

- [Architecture](text-architecture.md)
- [Trust and threat model](text-trust-and-threat-model.md)
- [Implementation map](text-implementation-map.md)
