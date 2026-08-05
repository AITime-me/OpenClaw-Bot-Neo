# Neo Text Communication — Implementation Map

> **Build 3.7A — design only (corrective).** Paths below are normative for future Builds.
> **Build 3.7B** implements package-private `src/core/communication/{domain,ports,policy}` offline.

## 1. Implementation sequence (normative)

1. **3.7A** — design documentation (closed; integrated).
2. **3.7E0** — subscription route feasibility (**closed research**).
3. **3.7B** — package-private domain, ports, policies, boundary rules (**closed contracts**; offline only).
4. **3.7C** — durable SQLite communication foundation (offline only; no live auth).
5. **3.7D** — application orchestrator and offline reference / fake completion only.
6. **3.7E1** — Codex/OpenClaw route **BLOCKED** pending capability probe and live gates.
7. **3.7F** — temporary owner-only Telegram adapter **BLOCKED** pending E1, encryption, operational
   approval.
8. Later: files/images → voice input → masculine voice output → plans/reminders → private mobile
   app → Telegram removal → read-only eyes → safe hands.

Build 3.7B–D are offline only

Build 3.7E1 status: BLOCKED

Build 3.7F status: BLOCKED

Build 3.7E0 next stage: 3.7B

Build 3.7E0 capability probe: NOT_RUN

Build 3.7B status: offline contracts implemented; live runtime absent.

Build 3.7B next stage: 3.7C

Research executive verdict remains FAIL under the absolute zero-paid-fallback criterion; technical
subscription route remains PASS; live operational approval remains UNRESOLVED. See
[3.7E0 closeout](../validation/build-3.7e0-subscription-route-feasibility.md).

Offline B–D work may proceed; live-oriented E1/F remain blocked.

## 2. Public API / barrel rule (B37A-004)

`src/index.ts` wildcard-exports `./core/domain/index.js` and `./core/ports/index.js`. Therefore:

- communication contracts are **package-private by default**;
- new communication modules are **not** added to root-reachable barrels
  (`src/core/domain/index.ts`, `src/core/ports/index.ts`, or other barrels already exported by
  package root);
- internal consumers import via package-private `src/core/communication/**` barrels that are
  **not** reachable from `src/index.ts`;
- root export of any communication symbol requires a separate public API review, proven external
  consumer, and explicit allowlist decision;
- replacing root wildcards with an explicit allowlist is a separate future Build/API review.

**3.7B must not** modify `src/index.ts` or root-reachable barrels for communication exports.
`tests/communication/communication-public-api-isolation.test.ts` must prove communication internals
are unavailable from the package root.

## 3. Exact new-file map by stage

### 3.7B — package-private domain / ports / policy

```text
src/core/communication/domain/communication-identity.ts
src/core/communication/domain/transport-text-observation.ts
src/core/communication/domain/authenticated-communication-principal.ts
src/core/communication/domain/authenticated-communication-principal.internal.ts
src/core/communication/domain/conversation-state.ts
src/core/communication/domain/communication-turn.ts
src/core/communication/domain/text-prompt.ts
src/core/communication/domain/llm-completion.ts
src/core/communication/domain/text-delivery.ts
src/core/communication/domain/communication-errors.ts
src/core/communication/domain/index.ts

src/core/communication/ports/communication-identity-binding.port.ts
src/core/communication/ports/conversation-state.port.ts
src/core/communication/ports/communication-turn-ledger.port.ts
src/core/communication/ports/communication-audit.port.ts
src/core/communication/ports/communication-delivery-outbox.port.ts
src/core/communication/ports/llm-completion.port.ts
src/core/communication/ports/text-delivery.port.ts
src/core/communication/ports/communication-kill-switch.port.ts
src/core/communication/ports/communication-id-generator.port.ts
src/core/communication/ports/communication-memory-authorization.port.ts
src/core/communication/ports/index.ts

src/core/communication/policy/communication-memory-authorization.ts
src/core/communication/policy/text-prompt-policy.ts
src/core/communication/policy/text-output-policy.ts
src/core/communication/policy/communication-kill-switch-policy.ts
src/core/communication/policy/index.ts
```

This tree is package-private and is not exported through root-reachable barrels.

### 3.7C0 — persistence decisions (contracts only; no SQLite)

```text
src/core/communication/ports/offline-communication-persistence.contract.ts
src/core/communication/domain/communication-recovery.ts
src/core/communication/domain/fresh-observed-admission-evidence.persistence.internal.ts
src/core/communication/domain/authenticated-communication-principal.persistence.internal.ts
src/core/communication/domain/validated-text-output.persistence.internal.ts
```

Future exact offline factory (not implemented in 3.7C0):

```text
src/host/storage/sqlite/communication/create-offline-sqlite-communication-ports.ts
```

### 3.7C — durable SQLite foundation (offline implemented)

```text
src/host/storage/sqlite/communication/sqlite-communication-constants.ts
src/host/storage/sqlite/communication/sqlite-communication-schema.ts
src/host/storage/sqlite/communication/sqlite-communication-serialization.ts
src/host/storage/sqlite/communication/sqlite-communication-errors.ts
src/host/storage/sqlite/communication/sqlite-conversation-state-port.ts
src/host/storage/sqlite/communication/sqlite-communication-turn-ledger-port.ts
src/host/storage/sqlite/communication/sqlite-communication-audit-port.ts
src/host/storage/sqlite/communication/sqlite-communication-delivery-outbox-port.ts
src/host/storage/sqlite/communication/create-offline-sqlite-communication-ports.ts
```

Database file: `neo-communication.sqlite` (not `neo-memory.sqlite`). Binding adapter remains
deferred. Factory is package-private and not exported from host/root barrels.

Build 3.7C status: offline SQLite persistence implemented; live runtime absent.

Build 3.7C next stage: 3.7D

### 3.7D — application / orchestrator / reference

```text
src/core/communication/application/normalize-transport-observation.service.ts
src/core/communication/application/authenticate-communication-principal.service.ts
src/core/communication/application/derive-communication-memory-access.service.ts
src/core/communication/application/admit-communication-turn.service.ts
src/core/communication/application/per-conversation-turn-dispatcher.ts
src/core/communication/application/assemble-text-prompt.service.ts
src/core/communication/application/validate-model-output.service.ts
src/core/communication/application/process-text-turn.service.ts
src/core/communication/application/recover-communication-turns.service.ts
src/core/communication/application/index.ts

src/communication/reference/reference-text-ingress.ts
src/communication/reference/reference-identity-binding.ts
src/communication/reference/reference-llm-completion.ts
src/communication/reference/reference-text-delivery.ts
src/communication/reference/create-reference-text-slice.ts
```

### 3.7E0

```text
docs/validation/build-3.7e0-subscription-route-feasibility.md
tests/build-3.7e0-subscription-route-feasibility-record.test.ts
```

Status: **closed** as research-only. Technical route PASS; live UNRESOLVED; E1/F blocked;
next stage 3.7B.

### 3.7E1 — blocked pending capability probe and live gates

```text
src/communication/adapters/codex-openclaw/codex-openclaw-capability-probe.ts
src/communication/adapters/codex-openclaw/codex-openclaw-llm-completion.ts
src/communication/adapters/codex-openclaw/create-codex-openclaw-route.ts
```

### 3.7F — blocked pending E1, encryption, operational approval

```text
src/communication/adapters/telegram/telegram-update-parser.ts
src/communication/adapters/telegram/telegram-text-ingress.ts
src/communication/adapters/telegram/telegram-text-delivery.ts
src/communication/adapters/telegram/create-telegram-owner-channel.ts
src/neo-runtime/production/create-production-text-communication.ts
```

### Future private mobile adapter

```text
src/communication/adapters/private-mobile/private-mobile-text-ingress.ts
src/communication/adapters/private-mobile/private-mobile-text-delivery.ts
src/communication/adapters/private-mobile/create-private-mobile-owner-channel.ts
```

### Exact verification files (implementation Builds)

```text
scripts/verify-communication-boundaries.mjs
scripts/verify-communication-flow.mjs
tests/communication/communication-domain.test.ts
tests/communication/communication-capability-security.test.ts
tests/communication/communication-ledger-state-machine.test.ts
tests/communication/communication-ledger-concurrency.test.ts
tests/communication/communication-restart-recovery.test.ts
tests/communication/communication-checkpoint-partial-failure.test.ts
tests/communication/communication-audit-partial-failure.test.ts
tests/communication/communication-deterministic-notice.test.ts
tests/communication/communication-kill-switches.test.ts
tests/communication/communication-prompt-injection.test.ts
tests/communication/communication-secret-leakage.test.ts
tests/communication/communication-memory-isolation.test.ts
tests/communication/communication-llm-outcome-unknown.test.ts
tests/communication/communication-delivery-outcome-unknown.test.ts
tests/communication/communication-fifo-ordering.test.ts
tests/communication/communication-encryption-live-gate.test.ts
tests/communication/communication-public-api-isolation.test.ts
tests/communication/communication-reference-integration.test.ts
```

## 4. Exact existing-file modification map (later Builds)

| File | Exact modification |
|------|--------------------|
| `scripts/lib/boundary-checker.mjs` | Add allowlists for `core/communication`, `communication`, host sqlite communication paths; forbid root barrel leakage. |
| `.dependency-cruiser.cjs` | Add matching layer rules for `src/core/communication/**` and `src/communication/**`. |
| `scripts/verify-boundaries.mjs` | Keep transport-term bans in non-adapter trees; invoke or complement communication verifiers. |
| `scripts/run-check.mjs` | Wire `verify-communication-boundaries.mjs` and `verify-communication-flow.mjs` into check composition when those scripts exist. |
| `package.json` | Add npm script entries for communication verifiers only when scripts exist (separate implementation Build). |
| `tests/public-api.test.ts` | Extend deny coverage so package root cannot observe communication internals (alongside dedicated communication public-api test). |
| `docs/channels.md` | Remain aligned with normative admission order and peer-adapter model. |
| `docs/architecture.md` | Remain aligned with design status notes. |

**Must not change for communication exports in 3.7B:**

- `src/index.ts`
- `src/core/domain/index.ts`
- `src/core/ports/index.ts`
- `src/core/policy/index.ts`
- `src/core/application/index.ts`

**Must not weaken:** memory-write AST isolation; connector/infrastructure boundary verifiers;
package `exports: "."` only; existing Neo/host diagnostics false flags.

**Exists today (reuse; not communication authority):**

- `src/core/application/memory-access.gateway.ts`
- `src/core/domain/memory-access.internal.ts`
- `src/core/routing/model-routing-policy.ts`
- `src/core/routing/route-resolver.port.ts`
- `src/core/ports/channel.port.ts`
- `src/core/domain/message.ts`
- `src/core/policy/sensitive-data-scanner.ts`
- `src/core/policy/recipient-whitelist.ts`

## 5. Boundary rules and negative fixtures

Rules:

- `src/core/communication/**` is package-private; not imported into root-reachable barrels.
- `src/communication/adapters/**` and `src/communication/reference/**` are app-private.
- Core communication forbids Telegram/OpenAI/OpenClaw SDK types.
- Text turn must not import connector/infrastructure registries.
- Sealers remain `.internal.ts` and non-exported from package root.

Negative fixtures:

```text
tests/fixtures/boundaries/forbidden-core-telegram-sdk/
tests/fixtures/boundaries/forbidden-communication-imports-connector/
tests/fixtures/boundaries/forbidden-communication-imports-infrastructure/
tests/fixtures/boundaries/forbidden-communication-barrel-via-domain-index/
tests/fixtures/boundaries/forbidden-communication-barrel-via-ports-index/
tests/fixtures/boundaries/forbidden-host-imports-telegram-adapter/
```

## 6. FIFO norms

- one active turn per canonical conversation;
- `maxDepthPerConversation` default = **8**;
- schema range = **2..64**;
- `maxGlobalPending` required and bounded;
- unlimited queue forbidden;
- order by trusted `conversationSequence` only.

## 7. Normative admission order (must match architecture)

```text
NORMATIVE_ADMISSION_ORDER:
sealed transport validation
→ atomic observed admission
→ duplicate stop
→ owner binding
→ authenticated
→ accepted + conversationSequence
```

## 8. Test matrix (exact files above)

Coverage includes: domain contracts; capability security; ledger state machine; ledger concurrency;
restart recovery; checkpoint partial failure; audit partial failure; deterministic notice;
kill switches; prompt injection; secret leakage; memory isolation; LLM outcome unknown; delivery
outcome unknown; FIFO ordering; encryption live gate; public API isolation; reference integration.

## 9. Acceptance criteria (3.7A design + corrective)

- Design package under `docs/communication/` with consistent admission order and notice path.
- Closeout markers + strengthened validation test PASS.
- No production communication runtime, adapters, SQLite communication stores, composition roots, or
  new runtime diagnostics.
- No package dependency adds; no communication exports via root-reachable barrels.
- Historical 3.5B/3.6B/R6 closeouts unchanged (content hash equal to base).
- Local quality gate green.

## 10. Non-goals

- Real Telegram / OAuth / OpenClaw live integration in 3.7A
- Encryption implementation in 3.7A
- Durable ledger/outbox/FIFO implementation in 3.7A
- Exactly-once delivery guarantee
- Production readiness / security approval claims

## 11. Definition of Done (corrective)

- Corrective commit subject: `docs(communication): correct Build 3.7A review findings`
- Gate PASS under `OPENCLAW_PRODUCTION_NODE_GATE=1`
- Next step after 3.7E0 independent review: **Build 3.7B** offline package-private contracts.

## 12. Full local gate

```text
$env:OPENCLAW_PRODUCTION_NODE_GATE = '1'
npm run check
npm run build
npm run check:systemd-template
git diff --check
```
