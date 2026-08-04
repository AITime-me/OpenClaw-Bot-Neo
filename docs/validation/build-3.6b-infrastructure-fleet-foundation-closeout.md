# Build 3.6B — Infrastructure and Timeweb Fleet Foundation closeout

## Scope

This record closes **Build 3.6B — Infrastructure and Timeweb Fleet Foundation** after the initial
implementation commit, two security corrective packages, final independent corrective-2 re-review
approval with INFO notes, and this documentation-only closeout commit.

This record does **not** establish:

- overall Codex Review №6 pass;
- broad security approval;
- production or VPS deployment;
- authoritative broad security validation;
- production Secret Provider configuration;
- encryption at rest;
- durable infrastructure persistence;
- real Timeweb API client;
- SSH implementation or library;
- VPS provisioning;
- production inventory wiring;
- production connector wiring;
- network validation;
- Linux validation;
- systemd validation;
- full L1–L5 orchestration;
- remote push;
- integration into local `main`.

Linux/systemd/full L1–L5 are **not required** for this offline foundation closeout.

AUTHORITATIVE_SECURITY_VALIDATION=false

SECURITY_APPROVAL_COMPLETE=false

DEPLOYMENT_READY=false

ENCRYPTION_ENABLED=false

SECRET_PROVIDER_CONFIGURED=false

## Build identities

| Item | Value |
|------|-------|
| Build 3.6B base (`main`) | `e4a89a0282603531f3454ad0f73e5bbdedfd1e18` |
| Feature branch | `build-3-6b-infrastructure-fleet-foundation` |
| Initial implementation commit | `2c08dea9f66ff5984aa2a3bf24f9396d69fa855c` |
| Initial implementation subject | `feat(infrastructure): add fleet inventory foundation and restricted ops contracts` |
| Security corrective commit 1 | `8bc4a8ceda02eaae82e6a2915ff076a1e022e61d` |
| Security corrective subject 1 | `fix(infrastructure): enforce bounded inventory and safe operation results` |
| Security corrective commit 2 | `50ba4867a15b1d558559dfb0a8ae498e5d8baa1f` |
| Security corrective subject 2 | `fix(infrastructure): type uncertain outcomes and stabilize secret detection` |
| Documentation closeout parent | `50ba4867a15b1d558559dfb0a8ae498e5d8baa1f` |
| Local `main` HEAD (unchanged) | `e4a89a0282603531f3454ad0f73e5bbdedfd1e18` |
| package-lock SHA-256 | `f8b9ce9fdbf3dd1d69f219df2a997e58b1cd5abcb077312b5151ba729175db54` (unchanged) |
| Node | `v22.13.0` |
| npm | `10.9.2` |

## Independent review history

### Initial source review (blocked)

| Item | Value |
|------|-------|
| Reviewed baseline | `2c08dea9f66ff5984aa2a3bf24f9396d69fa855c` |
| Verdict | `BLOCK_BUILD_3_6B_INFRASTRUCTURE_FLEET_FOUNDATION` |
| Final status | `BUILD_3_6B_INFRASTRUCTURE_FLEET_SOURCE_REVIEW_BLOCKED` |
| Findings | 3 HIGH, 7 MEDIUM |
| Failed invariants (original) | F10, F11, F18, F20 |

Material findings (IF-H01–IF-M07): log sanitization gaps, uncertain mutation success mapping,
runtime inventory parser bypass risk, path/update parity, production schema controls, reference host
redaction path, numeric sealing, SSH template exposure, insufficient behavioural tests.

### First security corrective package

| Item | Value |
|------|-------|
| Commit | `8bc4a8ceda02eaae82e6a2915ff076a1e022e61d` |
| Subject | `fix(infrastructure): enforce bounded inventory and safe operation results` |

First corrective re-review:

| Item | Value |
|------|-------|
| Verdict | `BLOCK_BUILD_3_6B_INFRASTRUCTURE_SECURITY_CORRECTIVE` |
| Final status | `BUILD_3_6B_INFRASTRUCTURE_SECURITY_CORRECTIVE_REREVIEW_BLOCKED` |

Remaining/new findings:

| ID | Severity | Issue |
|----|----------|-------|
| IF-CR01 | HIGH | Stateful `/gi` RegExp used through `.test()` caused alternating secret detection |
| IF-CR02 | HIGH | Shared orchestrator mapped outcome-unknown via infrastructure magic reason string |
| IF-CM01 | MEDIUM | Tests did not credibly prove CR01/CR02 and residual H02/H03/M06 |
| IF-H02 | residual | restart/audit/health/retry coverage incomplete |
| IF-H03 | residual | stateful secret predicate on public write paths |
| IF-M06 | residual | sanitizer and OU behavioural gaps |

Failed invariants at that point: F18, F25. F20 functionally passed but used unacceptable magic-string
coupling.

### Second security corrective package

| Item | Value |
|------|-------|
| Commit | `50ba4867a15b1d558559dfb0a8ae498e5d8baa1f` |
| Subject | `fix(infrastructure): type uncertain outcomes and stabilize secret detection` |

Final independent re-review:

| Item | Value |
|------|-------|
| Verdict | `APPROVE_WITH_NOTES_BUILD_3_6B_INFRASTRUCTURE_CORRECTIVE_2_FOR_CLOSEOUT` |
| Final status | `BUILD_3_6B_INFRASTRUCTURE_CORRECTIVE_2_REREVIEW_APPROVED_WITH_NOTES_FOR_CLOSEOUT` |

Confirmed: IF-CR01, IF-CR02, IF-CM01, IF-H02, IF-H03, IF-M06 CLOSED; IF-H01, IF-M01–M05, IF-M07
remain CLOSED; no new BLOCKER/HIGH/MEDIUM; F1–F25 PASS; single `ToolInvocationOrchestrator`
pipeline preserved; Build 3.5B connector guarantees preserved.

Independent reviewer mutation: read-only re-review; repository unchanged at `50ba486`.

## Finding closure disposition

| ID | Initial | Corrective-1 | Corrective-2 re-review | Final |
|----|---------|--------------|------------------------|-------|
| IF-H01 | OPEN | CLOSED | CLOSED | CLOSED |
| IF-H02 | OPEN | PARTIALLY_CLOSED | CLOSED | CLOSED |
| IF-H03 | OPEN | PARTIALLY_CLOSED | CLOSED | CLOSED |
| IF-M01 | OPEN | CLOSED | CLOSED | CLOSED |
| IF-M02 | OPEN | CLOSED | CLOSED | CLOSED |
| IF-M03 | OPEN | CLOSED | CLOSED | CLOSED |
| IF-M04 | OPEN | CLOSED | CLOSED | CLOSED |
| IF-M05 | OPEN | CLOSED | CLOSED | CLOSED |
| IF-M06 | OPEN | PARTIALLY_CLOSED | CLOSED | CLOSED |
| IF-M07 | OPEN | CLOSED | CLOSED | CLOSED |
| IF-CR01 | — | OPEN | CLOSED | CLOSED |
| IF-CR02 | — | OPEN | CLOSED | CLOSED |
| IF-CM01 | — | OPEN | CLOSED | CLOSED |

No remaining BLOCKER, HIGH or MEDIUM findings from the final re-review.

## F1–F25 invariants (final)

| ID | Result | Note |
|----|--------|------|
| F1 | PASS | Single `ToolInvocationOrchestrator` pipeline |
| F2 | PASS | No generic provider.execute tool |
| F3 | PASS | No host shell/command tool |
| F4 | PASS | Timeweb contract only |
| F5 | PASS | SSH contract/templates only; no implementation |
| F6 | PASS | Inventories cannot execute |
| F7 | PASS | Adapters cannot mutate declared inventory |
| F8 | PASS | Declared vs observed separated |
| F9 | PASS | `contentTrust=untrusted` only |
| F10 | PASS | Log/input caps + inventory parsers bound payloads |
| F11 | PASS | Full-buffer redaction + ANSI/control before output caps |
| F12 | PASS | Hard-deny overlay preserved |
| F13 | PASS | Exact-target schemas + canonical digest |
| F14 | PASS | Delete hard-denied |
| F15 | PASS | Purchase/plan hard-denied |
| F16 | PASS | Firewall/credential hard-denied |
| F17 | PASS | No secret resolve on deny/approval-required |
| F18 | PASS | Stateless secret predicates; logs redacted; bounded errors |
| F19 | PASS | No automatic mutation retry |
| F20 | PASS | Write-like uncertainty via typed `executionOutcome` |
| F21 | PASS | Reference adapters offline; not in production composition |
| F22 | PASS | Drift pure compare; no autonomous repair |
| F23 | PASS | Boundary scripts + negative orchestrator fixture green |
| F24 | PASS | package-lock unchanged; no migration/prod inventory |
| F25 | PASS | Orchestrator decoupled from infrastructure; typed OU contract |

## Implemented offline foundation

Build 3.6B provides:

- Environment Registry;
- Server Inventory;
- Service Inventory;
- separate untrusted observations;
- bounded health/resource snapshots;
- full-buffer safe log sanitization (multiline PEM, ANSI/control, caps);
- provider-neutral typed operations;
- Timeweb provider contract only (no HTTP client);
- Restricted Host Access contract;
- Restricted SSH contract only;
- closed trusted SSH template mapping (no caller `templateId`);
- generic connector-local `executionOutcome` (`known-failure` | `outcome-unknown`);
- hard-denied destructive/financial/firewall/credential operations;
- deterministic offline reference provider and host adapters;
- `ToolInvocationOrchestrator`-only execution;
- no autonomous drift repair;
- no real infrastructure connection.

Architecture foundation is implemented. Production adapters, production secrets, deployment, and
broad security approval remain deferred.

## Verification evidence

### Focused tests (corrective-2 re-review session)

| Suite | Result |
|-------|--------|
| `tests/infrastructure-platform/security-corrective.test.ts` | PASS |
| `tests/connector-platform/typed-outcome-unknown.test.ts` | PASS |
| `tests/connector-platform/connector-platform-security.test.ts` | PASS |
| `tests/connector-platform/connector-platform-approval-clock.test.ts` | PASS |
| `tests/boundaries.test.ts` (orchestrator negative fixture) | PASS |
| Focused aggregate | 160/160 PASS |

### Full suite and aggregate checks

| Check | Result |
|-------|--------|
| `npm run test:run` | 1825 passed / 3 skipped |
| `npm run format:check` | PASS |
| `npm run typecheck` | PASS |
| `tsc --noEmit -p tsconfig.integration.json` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `npm run check:infrastructure-boundaries` | PASS |
| `npm run check:connector-boundaries` | PASS |
| `npm run check:boundaries` | PASS |
| `npm run check:secrets` | PASS |
| `npm run check:hygiene` | PASS |
| `npm run check:systemd-template` | PASS |
| `npm run check:node` | PASS |
| `OPENCLAW_PRODUCTION_NODE_GATE=1 npm run check` | PASS |

No migration. No Timeweb network client. No SSH implementation. No production inventory wiring. No
deployment. No Linux/systemd/L1–L5 requirement for this offline foundation.

## INFO backlog (non-blocking)

Do **not** convert these into security approval blockers for Build 3.6B.

### IF-N01 — No dedicated observation secret-loop test

There is no dedicated repeated secret-loop behavioural test specifically for every observation
field.

Mitigation:

- observation writes use the same stateless runtime parsers (`parseBoundedText` /
  `rejectSecretOrCommand`);
- shared secret-shape predicates were tested repeatedly and through public inventory paths;
- no supported observation bypass was identified.

Disposition: non-blocking test-hardening backlog.

### IF-N02 — AST/boundary checks are not universal CFG proof

AST and dependency-boundary checks are not universal control-flow proofs.

Mitigation:

- dependency-cruiser rules (`connector-application-no-infrastructure`);
- explicit negative fixture (`forbidden-orchestrator-imports-infrastructure`);
- runtime behavioural tests;
- architecture layer allowlists;
- independent adversarial re-review.

Disposition: documented limitation, not a production-readiness claim.

## Deferred production scope

- production Timeweb API client absent;
- production SSH implementation absent;
- VPS provisioning absent;
- production inventory wiring absent;
- production connector wiring absent;
- production Secret Provider absent;
- encryption at rest absent;
- durable infrastructure persistence absent;
- production deployment absent;
- integration into local `main` pending owner-directed;
- push not performed.

Reference infrastructure adapters under `src/infrastructure/reference` and infrastructure connector
simulation controls are test/development-only and must not enter production Neo composition.

## Branch and integration status

- feature branch implementation and corrective packages completed at
  `50ba4867a15b1d558559dfb0a8ae498e5d8baa1f`;
- documentation closeout committed locally after this record;
- local `main` remains at `e4a89a0282603531f3454ad0f73e5bbdedfd1e18` (integration pending);
- no merge, rebase, cherry-pick or push occurred in this closeout task.

## Final dispositions

### Security corrective packages

`BUILD_3_6B_INFRASTRUCTURE_SECURITY_CORRECTIVES_CLOSED_WITH_STATELESS_SECRET_DETECTION_AND_TYPED_OUTCOME_UNKNOWN`

### Overall Build 3.6B fleet foundation

`BUILD_3_6B_INFRASTRUCTURE_FLEET_FOUNDATION_CLOSED_WITH_BOUNDED_INVENTORIES_RESTRICTED_OPERATIONS_AND_UNTRUSTED_OBSERVATIONS`
