# Build 3.7A — Neo Text Communication Vertical Slice Architecture Design closeout

## Scope

This record closes **Build 3.7A — Neo Text Communication Vertical Slice Architecture Design** as a
**documentation / validation-only** Build on feature branch
`build-3-7a-text-communication-design`.

This Build **designs** the first owner-only text communication contour. It does **not** implement
communication runtime, Telegram adapter, LLM adapter, SQLite communication stores, production
composition, or new runtime diagnostic fields.

This record does **not** establish:

- text communication implementation;
- live Telegram integration;
- live LLM / subscription OAuth route;
- OpenClaw runtime integration;
- durable communication turn ledger, conversation state, audit, or delivery outbox;
- encryption at rest;
- production or VPS deployment;
- broad or authoritative security approval;
- production Secret Provider configuration;
- connector or infrastructure tools attached to the text agent;
- package export expansion for communication gateways;
- merge into `main`;
- remote push.

AUTHORITATIVE_SECURITY_VALIDATION=false

SECURITY_APPROVAL_COMPLETE=false

DEPLOYMENT_READY=false

ENCRYPTION_ENABLED=false

SECRET_PROVIDER_CONFIGURED=false

DESIGN_ONLY=true

COMMUNICATION_RUNTIME_IMPLEMENTED=false

TELEGRAM_ADAPTER_IMPLEMENTED=false

LLM_PROVIDER_ROUTE_IMPLEMENTED=false

SUBSCRIPTION_ROUTE_FEASIBILITY=unresolved-hypothesis

## Build identities

| Item | Value |
|------|-------|
| Build 3.7A base | `b66237613edefffad0d691b863d7f2b8643fb5e1` |
| Base subject | `docs(infrastructure): close Build 3.6B fleet foundation` |
| Feature branch | `build-3-7a-text-communication-design` |
| Build kind | documentation / validation only |
| Local `main` | unchanged by this Build (no merge) |
| Push | not performed |

## Design package

| Document | Role |
|----------|------|
| [docs/communication/text-architecture.md](../communication/text-architecture.md) | Executive design, identities, pipeline, adapters, sequence |
| [docs/communication/text-trust-and-threat-model.md](../communication/text-trust-and-threat-model.md) | Trust boundaries, threats, kill switches, risks |
| [docs/communication/text-state-machines.md](../communication/text-state-machines.md) | Ledger states, restart, FIFO, outcome-unknown, audit |
| [docs/communication/text-implementation-map.md](../communication/text-implementation-map.md) | File map, tests, DoD, gate |
| This closeout | Honest status and next gates |

Point updates also land in README and selected `docs/*` status pages. Historical validation/closeout
records for Builds 3.5B, 3.6B, and Codex Review №6 focused items are **not** rewritten.

## Verified facts vs target vs hypothesis

### Verified facts (repository today)

- Build 3.6B infrastructure fleet foundation closed at base `b662376`.
- Authenticated **memory** access gateway and WeakMap sealing exist.
- Model-routing config parsers require subscription-oauth-only posture with API/paid fallbacks false.
- Thin `ChannelPort` / message types exist; they are not the final communication authority model.
- Neo lifecycle / durable LocalHost memory host exist without a text turn loop.
- Connector (3.5B) and infrastructure (3.6B) platforms exist offline and are not wired to a text agent.
- `deploymentReady=false`, `securityApprovalComplete=false`, `encryptionEnabled=false`,
  `durableApprovalPort=false`, `durableAuditPort=false`, and related honesty flags remain.

### Target architecture (designed, not implemented)

- Temporary Telegram adapter **or** future private mobile messenger adapter as equal transport peers.
- Channel-independent ingress; transport cannot mint trusted identities.
- Separate opaque families: `AuthenticatedCommunicationPrincipal` vs `AuthenticatedMemoryAccess`.
- Durable `CommunicationTurnLedgerPort`, `ConversationStatePort`, two-phase audit, bounded FIFO,
  tools-free `LlmCompletionPort`, encrypted-before-live delivery outbox, sealed same-binding delivery.
- Neo masculine persona as non-authority presentation aligned with VoiceProfile tone tags.

### Unresolved hypothesis

ChatGPT Plus / Codex **subscription** authentication as a 24/7 headless, restart-safe,
machine-usable, non–API-billed completion route is a **technical/policy hypothesis**.

Next gate: **Build 3.7E0 — Subscription Route Feasibility** with verdict
`PASS` | `FAIL` | `UNRESOLVED`. Large implementation spend on 3.7B–D must not proceed before E0.
Live implementation remains forbidden while `UNRESOLVED` or `FAIL`.

## Architectural invariants recorded by this design

1. Communication principal ≠ memory authority (separate opaque capabilities).
2. Transport observations are untrusted; trusted IDs and `observedAt` are assigned locally.
3. Durable turn ledger required before live; ephemeral replay only for offline reference simulation.
4. `LLM_OUTCOME_UNKNOWN` forbids automatic model replay; `DELIVERY_OUTCOME_UNKNOWN` forbids automatic resend and pauses/degrades conversation.
5. Two-phase audit: durable turn-start before LLM/delivery; completion records factual outcomes;
   delivered + failed completion audit remains delivered.
6. Encryption live gate: no live Telegram/model route that persists conversational content while
   encryption-at-rest (or approved alternative) is absent — **BLOCKER for live**, not for offline
   reference simulation. Encryption is **not** implemented in 3.7A.
7. Connector/infrastructure tools must not attach to the text communication core.
8. Future mobile messenger is a first-class equal adapter; Telegram is temporary.
9. No new runtime diagnostic fields in 3.7A; future flags listed in architecture doc remain absent.
10. Package root must not export app-private adapters, sealers, or composition roots.

## Future diagnostics (absent — not created in 3.7A)

- `textCommunicationProductionReady`
- `telegramAdapterActivated`
- `llmProviderActivated`
- `oauthSessionConfigured`
- `durableReplayStore`
- `durableCommunicationAudit`
- `connectorToolsAttachedToTextAgent`
- `openClawRuntimeIntegrated`

## Implementation sequence after 3.7A

1. Independent review of Build 3.7A design.
2. **3.7E0** — subscription route feasibility.
3. **3.7B** — contracts, capabilities, ports, policies, boundaries.
4. **3.7C** — durable binding, ledger, conversation state, two-phase audit, encrypted-before-live outbox.
5. **3.7D** — orchestrator + offline reference slice.
6. **3.7E1** — subscription adapter dry-run only after E0 `PASS`.
7. **3.7F** — temporary Telegram adapter only after gates + encryption live requirement.
8. Later modality and mobile-final path per architecture document.

## Disposition

`BUILD_3_7A_TEXT_COMMUNICATION_DESIGN_CLOSED_DOCUMENTATION_ONLY`

Final status:

`BUILD_3_7A_TEXT_COMMUNICATION_DESIGN_READY_FOR_INDEPENDENT_REVIEW`

## Explicit absences

- No production implementation of the text vertical slice.
- No live Telegram.
- No provider route implemented or verified.
- No production readiness.
- No security approval.
- No new runtime diagnostics.
- E0 feasibility is the next technical gate before large live-oriented implementation.
- Encryption is a live blocker for persisted conversational content.

## Next step

**Independent review of Build 3.7A.** Do not merge to `main`, push, or start large 3.7B–D
implementation spend until review guidance and E0 sequencing are respected.
