# Neo Text Communication — Implementation Map

> **Build 3.7A — design only.** File paths below are the planned map for future Builds. They must
> not be read as existing production modules unless marked **exists today**.

## 1. Implementation sequence (normative)

1. **3.7A** — design documentation only (this package).
2. **3.7E0** — subscription route feasibility **before** large implementation spend.
3. **3.7B** — domain contracts, opaque capabilities, ports, pure policies, boundary rules.
4. **3.7C** — durable binding, ledger, conversation state, two-phase audit, encrypted-before-live outbox.
5. **3.7D** — executable orchestrator and offline reference vertical slice.
6. **3.7E1** — real subscription adapter / local dry-run only after E0 `PASS`.
7. **3.7F** — temporary owner-only Telegram adapter only after gates + encryption live requirement.
8. Later verticals: files/images → voice input → masculine voice output → plans/reminders →
   private mobile app → Telegram removal → read-only eyes → safe hands.

Significant B–D implementation must not start before E0 verdict. Offline contract design may be
prepared, but live-oriented spend waits for `PASS`.

## 2. Future new-file map by stage

### 3.7B — contracts / policies / ports

- `src/core/domain/communication/inbound-observation.ts`
- `src/core/domain/communication/authenticated-communication-principal.internal.ts`
- `src/core/domain/communication/conversation-id.ts` (or identity extensions)
- `src/core/domain/communication/text-turn.ts`
- `src/core/domain/communication/turn-ledger-state.ts`
- `src/core/domain/communication/prompt-section.ts`
- `src/core/domain/communication/communication-audit-event.ts`
- `src/core/domain/communication/kill-switch-snapshot.ts`
- `src/core/domain/communication/index.ts`
- `src/core/ports/llm-completion.port.ts`
- `src/core/ports/communication-turn-ledger.port.ts`
- `src/core/ports/conversation-state.port.ts`
- `src/core/ports/text-delivery.port.ts`
- `src/core/ports/communication-audit.port.ts`
- `src/core/ports/delivery-outbox.port.ts`
- `src/core/policy/communication-owner-binding.ts`
- `src/core/policy/inbound-text-normalize.ts`
- `src/core/policy/prompt-assembly.ts`
- `src/core/policy/outbound-text-safety.ts`
- `src/core/policy/communication-kill-switch.ts`
- `src/core/policy/communication-memory-authorization.ts`
- `src/core/config/communication-config.ts`
- `config/communication/text-slice.example.json`
- `src/core/pipelines/text-turn.pipeline.md`

### 3.7C — durable stores (app-private implementations later under host/communication storage)

- SQLite (or approved) adapters for ledger, conversation state, audit, outbox — **app-private**
- Encryption-at-rest integration for outbox/checkpoints before live — separate security design

### 3.7D — orchestrator + offline reference

- `src/core/application/communication/text-turn.service.ts`
- `src/core/application/communication/text-communication.gateway.ts` (export decision explicit later)
- `src/communication/create-reference-text-communication.ts`
- `src/channels/reference/*` (simulated ingress/egress; no network)

### 3.7E1 / 3.7F — real adapters (app-private)

- `src/channels/telegram/*` — temporary transport only
- `src/channels/mobile/*` — future equal peer adapter
- LLM subscription adapter under app-private runtime path — only after E0 `PASS`

## 3. Existing files expected to change in later Builds

| File | Likely change |
|------|---------------|
| `src/core/domain/index.ts` | Export communication domain barrel (public types only). |
| `src/core/ports/index.ts` | Export new ports. |
| `src/core/policy/index.ts` | Export pure policies. |
| `src/core/application/index.ts` | Optional orchestrator exports — **not** automatic. |
| `src/index.ts` | Only explicit allowlisted public additions; **no** adapter/sealer/composition leaks. |
| `scripts/lib/boundary-checker.mjs` | Allowlists for `channels` / `communication` layers. |
| `.dependency-cruiser.cjs` | Matching dependency rules. |
| `scripts/verify-boundaries.mjs` | Keep transport terms banned in core/skills. |
| `tests/public-api.test.ts` | Deny adapters, sealers, SQLite comms, composition roots. |
| `docs/channels.md` / architecture status notes | Keep aligned (started in 3.7A). |

**Do not weaken:** memory-write AST isolation, connector/infrastructure boundary verifiers, package
`exports: "."` only, existing Neo/host diagnostics false flags.

**Exists today (reuse, do not redefine as communication authority):**

- `src/core/application/memory-access.gateway.ts` (`ChannelAuthenticationPort`, memory gateway)
- `src/core/domain/memory-access.internal.ts` (memory capability sealing)
- `src/core/routing/model-routing-policy.ts` / `route-resolver.port.ts`
- `src/core/ports/channel.port.ts`, `src/core/domain/message.ts` (thin legacy; not final envelopes)
- `src/core/policy/sensitive-data-scanner.ts`, `recipient-whitelist.ts`

## 4. Boundary rules and negative fixtures (planned)

Rules:

- `core/**` forbids Telegram/OpenAI/OpenClaw SDK and transport-specific identifiers.
- `channels/**` app-private; must not be imported by `host/**` composition that would leak into
  unintended surfaces; must not be package-exported.
- `communication/**` composition app-private; must not wire connector/infrastructure registries
  into text turn.
- Sealers remain `.internal.ts` and non-exported.
- Transport terms continue to fail `verify-boundaries` in core/skills.

Negative fixtures (examples):

- `tests/fixtures/boundaries/forbidden-core-telegram-sdk/`
- `tests/fixtures/boundaries/forbidden-communication-imports-connector/`
- `tests/fixtures/boundaries/forbidden-communication-imports-infrastructure/`
- `tests/fixtures/boundaries/forbidden-channels-export-via-index/`
- `tests/fixtures/boundaries/forbidden-host-imports-telegram-adapter/`

## 5. Full test matrix (future implementation Builds)

| Suite | Coverage |
|-------|----------|
| Unit | Binding, normalize, prompt order, kill-switch snapshot, outbound safety, ledger transition helpers |
| Integration | Offline reference ingress→turn→egress; memory read via separate capability; LLM stub outcomes |
| Boundary | Fixtures above; public API deny-list |
| Security | Object literal ≠ principal; scanner on sinks; no connector attach |
| Replay/duplicate | Atomic admission; no second LLM |
| Prompt injection | Tools/recipient/fallback/audit unchanged |
| Secret leakage | Token-like input denied/redacted; absent from audit/ledger |
| Context isolation | Transcript ≠ semantic memory; summary untrusted |
| Owner impersonation | Wrong external sender rejected |
| Timeout/cancellation | Distinct codes; no success |
| Delivery retry | No auto resend on outcome-unknown; known failure policy explicit |
| Crash/restart | llm_started / delivery_started recovery rules |
| Public API isolation | No adapters/sealers/composition in package root |

## 6. Acceptance criteria (3.7A design Build)

- Design package present under `docs/communication/`.
- Closeout record present and honest (design-only; implementation absent).
- Closeout validation test passes.
- No production communication runtime, Telegram/LLM adapters, SQLite communication stores,
  composition roots, or new runtime diagnostic fields added.
- No package dependency adds; no `src/index.ts` communication factory exports.
- Existing 3.5B/3.6B/R6 historical closeouts untouched.
- Local quality gate green on documentation+test commit.

## 7. Non-goals (3.7A and deferred)

- Real Telegram bot / webhook / polling
- Real subscription OAuth session / OpenClaw integration
- Encryption implementation
- Durable ledger/outbox implementation
- FIFO queue implementation
- Voice, media, connectors-as-tools, payments, autonomy, VPS deployment
- Claims of production readiness or security approval
- Exactly-once delivery guarantee

## 8. Definition of Done (3.7A)

- Design docs + closeout + validation test committed on
  `build-3-7a-text-communication-design`.
- Gate: `OPENCLAW_PRODUCTION_NODE_GATE=1` → `npm run check`, `npm run build`,
  `npm run check:systemd-template`, `git diff --check` PASS.
- Next step is **independent review of Build 3.7A**, then **3.7E0** feasibility — not silent start
  of large B–D implementation.

## 9. Full local gate

```text
$env:OPENCLAW_PRODUCTION_NODE_GATE = '1'
npm run check
npm run build
npm run check:systemd-template
git diff --check
```

`npm run check` includes node gate, typecheck, lint, format, tests, boundaries, secrets, hygiene.
