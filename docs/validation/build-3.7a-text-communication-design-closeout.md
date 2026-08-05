# Build 3.7A — Neo Text Communication Vertical Slice Architecture Design closeout

## Machine-readable markers

```text
BUILD_ID: 3.7A
BUILD_KIND: DESIGN_ONLY
IMPLEMENTATION_STATUS: ABSENT
LIVE_TELEGRAM: ABSENT
LIVE_LLM_ROUTE: ABSENT
SUBSCRIPTION_ROUTE_STATUS: FEASIBILITY_REQUIRED
ENCRYPTION_LIVE_GATE: BLOCKING
PRODUCTION_READY: FALSE
SECURITY_APPROVED: FALSE
NEXT_GATE: 3.7E0
CONNECTOR_TOOLS_ATTACHED: FALSE
INFRASTRUCTURE_TOOLS_ATTACHED: FALSE
```

## Scope

This record closes **Build 3.7A — Neo Text Communication Vertical Slice Architecture Design** as a
**documentation / validation-only** Build on feature branch
`build-3-7a-text-communication-design`, including the documentation corrective that closes
independent review findings B37A-001…B37A-007.

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
- merge into `main` of this feature branch;
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
| Design commit | `73b65527beb663bd8fac91d8d3fef6e69be764a6` |
| Design subject | `docs(communication): design Build 3.7A text vertical slice` |
| Feature branch | `build-3-7a-text-communication-design` |
| Build kind | documentation / validation only |
| Corrective subject | `docs(communication): correct Build 3.7A review findings` |
| Push | not performed |

## Design package

| Document | Role |
|----------|------|
| [docs/communication/text-architecture.md](../communication/text-architecture.md) | Executive design, admission order, statuses, adapters |
| [docs/communication/text-trust-and-threat-model.md](../communication/text-trust-and-threat-model.md) | Trust boundaries, threats, kill switches, risks |
| [docs/communication/text-state-machines.md](../communication/text-state-machines.md) | Ledger states, notice path, restart, FIFO |
| [docs/communication/text-implementation-map.md](../communication/text-implementation-map.md) | Exact file map, package-private API rule, tests |
| This closeout | Honest status and next gates |

Point updates also land in README and selected `docs/*` status pages. Historical validation/closeout
records for Builds 3.5B, 3.6B, and Codex Review №6 focused items are **not** rewritten.

## Independent review corrective closure

| Finding | Severity | Closure |
|---------|----------|---------|
| B37A-001 | HIGH | Unified normative admission order; ledger splits observed/auth/accepted |
| B37A-002 | MEDIUM | Orthogonal delivery/checkpoint/audit statuses; checkpoint failure contract |
| B37A-003 | MEDIUM | Deterministic notice legal path via `llm_known_failed` / `deterministic_notice_prepared` |
| B37A-004 | MEDIUM | Package-private `src/core/communication/**`; no root-reachable barrel exports |
| B37A-005 | MEDIUM | Exact normative file map and test paths; FIFO default 8 / range 2..64 |
| B37A-006 | MEDIUM | Strengthened closeout validation test (markers, git scope, hash protection, consistency) |
| B37A-007 | LOW | Current status docs synced: Build 3.6B integrated at baseline `b662376` |

## Normative admission order

```text
NORMATIVE_ADMISSION_ORDER:
sealed transport validation
→ atomic observed admission
→ duplicate stop
→ owner binding
→ authenticated
→ accepted + conversationSequence
```

Principal is never created before atomic observed admission. Transport never mints trusted IDs.

## Verified facts vs target vs hypothesis

### Verified facts (repository today)

- Build 3.6B infrastructure fleet foundation is integrated; Build 3.7A design base is `b662376`
  (`docs(infrastructure): close Build 3.6B fleet foundation`). Historical closeout text that still
  says “integration pending” is a **snapshot** of that past Build record and is not rewritten.
- Authenticated **memory** access gateway and WeakMap sealing exist.
- Model-routing config parsers require subscription-oauth-only posture with API/paid fallbacks false.
- Thin `ChannelPort` / message types exist; they are not the final communication authority model.
- Neo lifecycle / durable LocalHost memory host exist without a text turn loop.
- Connector (3.5B) and infrastructure (3.6B) platforms exist offline and are not wired to a text agent.
- `deploymentReady=false`, `securityApprovalComplete=false`, `encryptionEnabled=false`,
  `durableApprovalPort=false`, `durableAuditPort=false`, and related honesty flags remain.
- `src/index.ts` wildcard-exports core domain/ports barrels (package-private communication tree
  required to avoid accidental root expansion).

### Target architecture (designed, not implemented)

- Temporary Telegram adapter **or** future private mobile messenger adapter as peer transport adapters.
- Normative admission order above; durable ledger; FIFO; two-phase audit; tools-free LLM port;
  deterministic notice path; encrypted-before-live outbox; sealed same-binding delivery;
  orthogonal `deliveryStatus` / `checkpointStatus` / `auditStatus`.

### Unresolved hypothesis

ChatGPT Plus / Codex subscription authentication as a 24/7 headless completion route remains a
technical/policy hypothesis. Next gate: **Build 3.7E0** (`PASS` | `FAIL` | `UNRESOLVED`).

## Architectural invariants

1. Communication principal ≠ memory authority (separate opaque capabilities).
2. Atomic observed admission precedes owner binding and principal creation.
3. `LLM_OUTCOME_UNKNOWN` forbids automatic model replay and forbids deterministic notice.
4. `DELIVERY_OUTCOME_UNKNOWN` forbids automatic resend and pauses/degrades conversation.
5. Audit start occurs before LLM.
6. Delivered fact is retained when checkpoint or completion audit fails.
7. Encryption live gate blocks live persisted conversational content without encryption.
8. Connector/infrastructure tools must not attach to the text communication core.
9. Future mobile messenger is a peer adapter; Telegram is temporary.
10. Package-private communication contracts do not enter root-reachable barrels.
11. FIFO: default depth 8; range 2..64; bounded global pending; one active turn per conversation.
12. No new runtime diagnostic fields in 3.7A.

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

1. Focused independent re-review of the corrective diff.
2. **3.7E0** — subscription route feasibility.
3. **3.7B** — package-private contracts.
4. **3.7C** — durable SQLite communication foundation.
5. **3.7D** — orchestrator + offline reference slice.
6. **3.7E1** — subscription adapter dry-run only after E0 `PASS`.
7. **3.7F** — temporary Telegram adapter only after gates + encryption live requirement.
8. Later modality and mobile-final path per architecture document.

## Disposition

`BUILD_3_7A_TEXT_COMMUNICATION_DESIGN_CLOSED_DOCUMENTATION_ONLY`

Final status:

`BUILD_3_7A_TEXT_COMMUNICATION_DESIGN_READY_FOR_FOCUSED_INDEPENDENT_REREVIEW`

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

**Focused independent re-review of the Build 3.7A corrective diff in Codex.** Do not merge to
`main`, push, or start large 3.7B–D implementation spend until review guidance and E0 sequencing
are respected.
