# Neo Text Communication Vertical Slice — Architecture Design

> **Build 3.7A — design only.** This document fixes target architecture for the first owner-only
> text communication contour. It does **not** claim implementation, live Telegram, live LLM route,
> production readiness, or security approval.
>
> Verified foundation baseline: Build 3.6B closed on `b662376` (infrastructure fleet foundation).
> Text communication runtime code is **absent**.

## 1. Executive design

Neo is an owner-only personal assistant with a masculine persona (calm, intelligent, confident,
restrained, slightly futuristic; not call-center cheerful). Persona is presentation only and is
**not** a security authority.

The first communication vertical slice is text-only:

owner → temporary Telegram adapter **or** future private mobile messenger adapter →
channel-independent communication ingress → trusted identity binding →
`AuthenticatedCommunicationPrincipal` → durable atomic turn admission →
bounded per-conversation FIFO → immutable policy/kill-switch snapshot → two-phase audit →
bounded conversation context → separately authorized read-only memory access →
provider-independent tools-free LLM port → untrusted output validation →
encrypted-before-live short-lived delivery outbox → sealed same-binding delivery →
durable factual outcome → conversation checkpoint → completion audit.

### Status separation (mandatory)

| Kind | Meaning in this document |
|------|--------------------------|
| **Verified fact** | Exists in current repository code/tests/closeouts (e.g. memory gateway, routing policy parsers, Neo lifecycle, connector/infra offline platforms unwired to text agent). |
| **Target architecture** | Normative design for upcoming implementation Builds 3.7B–F. |
| **Unresolved hypothesis** | Subscription OAuth headless feasibility and provider-policy compatibility — gated by **Build 3.7E0** before large live-oriented spend. |

## 2. Telegram temporary / mobile final

| Role | Design |
|------|--------|
| Telegram | **Temporary** app-private transport adapter only. |
| Final UI | Owner-only private mobile app / closed messenger talking to the same communication core. |
| Core independence | Communication core must not import Telegram SDK types, update/chat/message identifiers, or transport markup. |

Telegram must be removable and replaceable by a mobile adapter **without rewriting**:

- canonical conversation identity and state;
- semantic memory access path;
- LLM routing contracts;
- communication orchestration;
- security policy.

Both adapters emit the same channel-independent untrusted observation shape into core.

## 3. Target architecture

```text
Transport adapter (Telegram | future mobile)     [app-private]
        │ untrusted bounded observation only
        ▼
Communication ingress / normalize                [core policy]
        ▼
Trusted owner/conversation binding               [trusted local boundary]
        ▼
AuthenticatedCommunicationPrincipal             [opaque capability]
        ▼
Durable CommunicationTurnLedgerPort              [atomic admission]
        ▼
Bounded per-conversation FIFO (depth 2..64)      [one active turn]
        ▼
Immutable kill-switch + limits snapshot
        ▼
Two-phase audit start                            [before LLM/delivery]
        ▼
Ephemeral context window + ConversationStatePort
        ▼
Separate memory authorization → AuthenticatedMemoryAccess (read-only)
        ▼
Prompt assembly (fixed section order)
        ▼
LlmCompletionPort (tools-free)
        ▼
Outbound validation (untrusted model output)
        ▼
Short-lived delivery outbox (encrypted-before-live gate)
        ▼
Sealed same-binding TextDeliveryPort
        ▼
Durable factual outcome + conversation checkpoint + completion audit
```

### Verified reusable foundation (not the slice itself)

- Opaque memory auth: `AuthenticationObservation` → `sealAuthenticatedMemoryAccess` /
  `AuthenticatedMemoryAccessContext` via `MemoryAccessGateway`.
- Fail-closed memory-write pipeline and scanner.
- Pure model routing (`subscription-oauth` tiers; `apiFallbackEnabled` /
  `paidFallbackEnabled` must be false in config parsers).
- Thin `ChannelPort` / `IncomingMessage` / `OutgoingMessage` exist but are **not** the target
  communication envelope or authority model.
- Neo process lifecycle / durable LocalHost memory host exist; they do **not** run a text turn loop.
- Connector platform (3.5B) and infrastructure fleet (3.6B) exist offline and must **not** auto-wire
  into the text agent.

### Absent today (target only)

Communication principal sealers, turn ledger, conversation state port, FIFO queue, text-turn
orchestrator, LLM completion port/adapters, delivery outbox, Telegram/mobile adapters, two-phase
communication audit, and communication composition roots.

## 4. Identities and capability derivation

### Transport may provide only untrusted observations

Bounded fields after structural parse (raw SDK DTO stays inside the adapter):

- transport instance reference;
- external message reference;
- external conversation reference;
- external sender reference;
- optional source timestamp (metadata only; **not** ordering authority);
- raw text.

Transport **must not** assign trusted: `OwnerId`, `ActorId`, authority, canonical `ConversationId`,
`SessionId`, `TurnId`, `CorrelationId`, `IdempotencyKey`, or `observedAt`.

### Trusted local boundary assigns

- exact owner/conversation binding from allowlist + transport instance validation;
- canonical `ConversationId`;
- `TurnId`, `CorrelationId`;
- derived idempotency key for the transport event;
- trusted `observedAt` from `ClockPort`;
- monotonic `conversationSequence` for FIFO ordering.

### Two opaque capability families (non-interchangeable)

| Capability | Purpose |
|------------|---------|
| `AuthenticatedCommunicationPrincipal` | Proves trusted communication binding for the turn. |
| `AuthenticatedMemoryAccess` | Separately authorized, typically bounded **read-only** memory access for the turn. |

Derivation path:

```text
untrusted transport observation
  → trusted transport-instance validation
  → exact owner/conversation binding
  → AuthenticatedCommunicationPrincipal
  → communication→memory authorization policy
  → bounded read-only AuthenticatedMemoryAccess
```

Ordinary object literal, spread, JSON clone, or prototype clone **cannot** forge either capability.
Channel adapters do **not** receive communication or memory sealers.

Existing memory sealing remains the memory capability family. Communication principal is a
**new** family to be introduced in implementation Builds; it must not be collapsed into memory
auth or into message text fields.

## 5. End-to-end pipeline

1. Adapter accepts transport update → emits channel-independent validated-but-untrusted value object.
2. Ingress structural/size/UTF-8 validation; non-text media rejected in this slice.
3. Kill-switch precheck may drop/ignore safely when ingress disabled.
4. Trusted binding → `AuthenticatedCommunicationPrincipal` or reject unknown sender.
5. Durable ledger **atomic unique admission** of the transport event (no second LLM for duplicates).
6. Enqueue on bounded per-conversation FIFO; one active turn; overflow → `QUEUE_FULL`.
7. At head-of-queue: freeze immutable policy/kill-switch/limits snapshot.
8. Two-phase audit: durable turn-start **before** any LLM or delivery.
9. Load ephemeral context window + durable conversation checkpoint metadata as needed.
10. Optionally obtain separately authorized read-only memory access; inject excerpts with provenance.
11. Assemble prompt in fixed order (§7).
12. Invoke tools-free `LlmCompletionPort` with budgets, timeout, cancellation.
13. Validate model output as untrusted; normalize to plain text for first Telegram adapter.
14. Place delivery payload in short-lived outbox (live content persistence requires encryption gate).
15. Deliver only to sealed same-binding recipient.
16. Record durable factual LLM/delivery outcomes; update conversation checkpoint; completion audit.
17. Never treat `DELIVERY_OUTCOME_UNKNOWN` or `LLM_OUTCOME_UNKNOWN` as success; no automatic
    model replay or automatic resend.

## 6. State separation

Independent stores — **not** interchangeable:

| Store | Role |
|-------|------|
| Ephemeral active context window | Short-lived turns for prompting; process-local. |
| Durable `ConversationStatePort` | Checkpoint, pause/degraded flags, sequence cursor. |
| Durable semantic `MemoryPort` | Existing namespaced memory; not automatic chat log. |
| Durable `CommunicationTurnLedgerPort` | Turn lifecycle metadata/digests/outcomes only. |
| Short-lived delivery outbox | Pending delivery payloads; encrypted-before-live. |

Rules:

- Ordinary messages do **not** automatically become semantic memory.
- Raw transcript persistence is **off by default**.
- Model-generated summaries are `model-derived`, untrusted, not confirmed facts, not security
  authority, and must not be written as trusted semantic facts without a separate explicit process.
- Ledger stores identifiers, digests, timestamps, states, attempt counters, outcomes, safe error
  categories — **never** raw user text, raw model output, full prompts, memory contents, or credentials.

## 7. Prompt model

Fixed section order:

1. Immutable system security policy.
2. Neo persona (masculine calm/intelligent/confident/restrained/slightly-futuristic; not authority).
3. Memory excerpts with provenance/trust labels.
4. Conversation context as untrusted contextual material.
5. Current owner text as untrusted input.

Prompt injection must not: change policy; enable tools/functions; change recipient; forge
capabilities; expand memory scope; activate API/paid fallback; attach connector/infrastructure
tools; mutate kill switches; disable audit/scanner. Credentials, raw audit, internal prompts, and
secret memory fields are excluded from prompts.

## 8. LLM contract

Provider-independent tools-free `LlmCompletionPort`:

- bounded input/output;
- timeout;
- `AbortSignal` / cancellation;
- outcomes: completed, provider unavailable, known timeout, cancelled, invalid response,
  outcome unknown.

Absent from the port and from text-turn composition: tools, functions, tool executor, connector
registry, infrastructure registry, shell, arbitrary recipient.

JSON-like or tool-call-looking text remains ordinary untrusted text and is **not** executed.

### Subscription route (architectural goal vs hypothesis)

**Goal:** ChatGPT Plus / Codex subscription authentication; not OpenAI API key; not token-billed
API; `apiFallbackEnabled=false`; `paidFallbackEnabled=false`; no silent fallback.

**Unresolved hypothesis (Build 3.7E0 gate):** this repository design does **not** prove 24/7
headless backend acceptability, machine-usable completion interface, restart-safe authentication,
absence of interactive session dependency, absence of hidden API billing, provider-policy
compatibility, or VPS session security.

E0 verdicts: `PASS` | `FAIL` | `UNRESOLVED`. Live-oriented implementation spend on B–D must not
proceed before E0; offline provider-independent core design may continue, but significant
implementation of B–D waits for E0.

## 9. Delivery

- Model output is always untrusted until outbound validation.
- Checks: UTF-8, bounded bytes/code points, control-character policy, secret/sensitive scan,
  plain-text normalization, no arbitrary recipient, no transport formatting in core.
- First Telegram adapter: **plain text only** (no Markdown/HTML parse mode).
- Recipient only from sealed canonical conversation binding.
- Outbox may hold conversational content → **encryption live gate** applies before live routes.
- Exactly-once delivery is **not** claimed. `DELIVERY_OUTCOME_UNKNOWN` is not success, not known
  failure, forbids automatic resend, is durable, pauses/degrades conversation, needs reconciliation
  or explicit owner/operator resolution.

### Deterministic system notices vs model responses

When the model is unavailable or a **known** timeout occurs, a pre-approved deterministic system
notice may be delivered only if audit and delivery work, recipient comes from sealed binding, text
is not model-generated, internals are not disclosed, and this is not an API/paid fallback.
`LLM_OUTCOME_UNKNOWN` forbids automatic model retry.

## 10. Adapters and public/private boundaries

**App-private (never package-root exports):** Telegram adapter, mobile adapter, Codex/OpenClaw
adapter, SQLite communication implementations, composition roots, sealers, transport bindings,
credential/session readers, delivery target implementations.

**Public API:** do not automatically add communication gateway/composition factories to
`src/index.ts`. Future public surface, if any, is an explicit allowlisted decision.

**Must not weaken:** Build 3.5B connector and Build 3.6B infrastructure isolation; memory WeakMap
sealing; root-only package exports; existing false readiness diagnostics.

## 11. Implementation sequence

1. **3.7A** — this design documentation only (current Build).
2. **3.7E0** — early subscription route feasibility **before** large implementation spend.
3. **3.7B** — domain contracts, opaque capabilities, ports, pure policies, boundary rules.
4. **3.7C** — durable binding, ledger, conversation state, two-phase audit, encrypted-before-live outbox.
5. **3.7D** — executable orchestrator and offline reference vertical slice.
6. **3.7E1** — real subscription adapter / local dry-run only after E0 `PASS`.
7. **3.7F** — temporary owner-only Telegram adapter only after gates and encryption live requirement.
8. Later: files/images → voice input → masculine voice output → plans/reminders → private mobile app
   → Telegram removal → read-only eyes → safe hands.

## 12. Future diagnostics (not created in 3.7A)

Design lists future honest flags; **Build 3.7A does not add runtime diagnostic fields**:

- `textCommunicationProductionReady`
- `telegramAdapterActivated`
- `llmProviderActivated`
- `oauthSessionConfigured`
- `durableReplayStore`
- `durableCommunicationAudit`
- `connectorToolsAttachedToTextAgent`
- `openClawRuntimeIntegrated`

Existing invariants remain false / disabled: `deploymentReady`, `securityApprovalComplete`,
`secretProviderConfigured`, `encryptionEnabled`, `durableApprovalPort`, `durableAuditPort`,
`networkIsolationEnforced`, `apiFallbackEnabled`, `paidFallbackEnabled`.

## Related documents

- [Trust and threat model](text-trust-and-threat-model.md)
- [State machines](text-state-machines.md)
- [Implementation map](text-implementation-map.md)
- [Build 3.7A closeout](../validation/build-3.7a-text-communication-design-closeout.md)
- [Channels](../channels.md), [LLM provider](../llm-provider.md), [Security policy](../security-policy.md)
