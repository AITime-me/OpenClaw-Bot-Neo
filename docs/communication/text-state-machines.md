# Neo Text Communication — State Machines

> **Build 3.7A — design only.** Machines below are normative for future implementation. No durable
> communication ledger, outbox, or FIFO queue exists in the repository today.

## 1. Durable turn ledger states

Minimum states:

`observed` · `authentication_rejected` · `authenticated` · `accepted` · `queued` ·
`llm_started` · `llm_completed` · `output_validated` · `delivery_started` · `delivered` ·
`delivery_failed` · `delivery_outcome_unknown` · `cancelled` · `completed`

### Intended happy path

```text
observed
  → authenticated
  → accepted
  → queued
  → llm_started
  → llm_completed
  → output_validated
  → delivery_started
  → delivered
  → completed
```

Authentication failure path: `observed → authentication_rejected` (terminal for that event;
safe audit as applicable).

Cancellation may enter `cancelled` from pre-LLM states when kill switches or operator cancel apply
before external spend; after `llm_started`, prefer outcome-unknown / completion recording over
silent cancel-as-success.

## 2. Legal vs illegal transitions (normative summary)

**Legal (representative):**

| From | To | Condition |
|------|----|-----------|
| observed | authenticated | binding success |
| observed | authentication_rejected | binding failure / uncertain deny |
| authenticated | accepted | atomic unique admission success |
| accepted | queued | enqueued under FIFO limits |
| queued | llm_started | snapshot allows LLM; audit start recorded |
| llm_started | llm_completed | provider returned bounded completion |
| llm_started | delivery path via degraded notice | only for **known** unavailable/timeout with notice rules; still records LLM outcome distinctly |
| llm_completed | output_validated | outbound checks pass |
| output_validated | delivery_started | delivery enabled; outbox accepted |
| delivery_started | delivered | provider ack success |
| delivery_started | delivery_failed | known failure |
| delivery_started | delivery_outcome_unknown | uncertainty |
| delivered / delivery_failed / delivery_outcome_unknown / cancelled | completed | completion audit attempted |

**Illegal (representative):**

- `observed → llm_started` (skips auth/admission/audit-start)
- second `accepted` for the same transport-event admission key
- `llm_completed → llm_started` automatic retry after `LLM_OUTCOME_UNKNOWN`
- `delivery_outcome_unknown → delivery_started` automatic resend
- `delivered → delivery_failed` rewrite after success
- any transition that enables tools/connectors from model output

## 3. Restart recovery

| Prior durable state | After restart |
|---------------------|---------------|
| `accepted` / `queued` | May be restored and continued under current kill-switch snapshot. |
| `llm_started` without completion | Become / record `LLM_OUTCOME_UNKNOWN`; **no automatic** model re-invoke. |
| `delivery_started` without outcome | Become / record `DELIVERY_OUTCOME_UNKNOWN`; **no automatic** resend. |
| `delivered` | Remains delivered; completion audit may idempotently retry if needed. |
| Ephemeral-only simulation store | Lost; allowed only for offline reference simulation, not live. |

## 4. Duplicate / replay

- Idempotency key derived at trusted boundary from transport instance + external message reference
  (exact derivation fixed in 3.7B contracts).
- Atomic unique admission: first accept wins; duplicates map to prior factual outcome without a
  second LLM invocation.
- Ephemeral replay maps are **not** sufficient for live.

## 5. FIFO and ordering

- Configurable bounded per-conversation FIFO.
- One active turn per conversation.
- Order by trusted monotonic `conversationSequence` (not source timestamp).
- Default depth suggestion: **8**; schema range **2..64**; unlimited queue forbidden.
- Global bounded pending limit across conversations.
- Overflow → `QUEUE_FULL` (no silent drop that looks like success).

## 6. LLM outcome unknown

- Not success.
- Durable.
- Forbids automatic model replay.
- May leave conversation degraded until operator/owner policy resolves.
- Distinct from known `PROVIDER_UNAVAILABLE` / `LLM_TIMEOUT` (those may use deterministic system
  notices under strict notice rules).

## 7. Delivery outcome unknown

- Not success; not known failure.
- Forbids automatic resend.
- Durable.
- Moves conversation to **paused/degraded**.
- Requires future reconciliation or explicit owner/operator resolution.
- Duplicate delivery absence is **not** promised without provider reconciliation.

## 8. Two-phase audit state model

**Phase A — before expensive/external work:**

1. Audit capability available.
2. Durable turn-start event written.
3. Only then LLM and/or delivery may proceed.

**Phase B — after factual outcomes:**

1. Durable completion event with LLM and delivery outcomes.
2. If delivered but completion audit fails: `delivered=true`, `auditStatus=failed`.
3. Idempotent completion-audit retry allowed; delivery not automatically retried.

Audit events carry identifiers, digests, statuses, timings, safe error categories — not raw bodies,
prompts, model output, or memory contents.

## 9. Conversation pause / reconciliation

Triggers for pause/degraded include: `DELIVERY_OUTCOME_UNKNOWN`, unresolved
`LLM_OUTCOME_UNKNOWN` per policy, encryption live gate blocking outbox flush to live adapters,
malformed config, audit/ledger unavailability.

Resume requires explicit future reconciliation design (out of 3.7A implementation scope): compare
provider receipts, owner confirmation, or operator tooling — never silent automatic resend of
uncertain deliveries.

## Related documents

- [Architecture](text-architecture.md)
- [Trust and threat model](text-trust-and-threat-model.md)
- [Implementation map](text-implementation-map.md)
