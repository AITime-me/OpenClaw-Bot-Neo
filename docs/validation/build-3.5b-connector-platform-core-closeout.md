# Build 3.5B — Connector Platform Core closeout

## Scope

This record closes **Build 3.5B — Connector Platform Core** after the primary implementation
commit, security corrective package, feature-branch closeout, fast-forward integration into local
`main`, Windows worktree-only EOL diagnosis, approval clock corrective, and focused independent
re-review of the clock corrective.

This record does **not** establish:

- overall Codex Review №6 pass;
- broad security approval;
- production or VPS deployment;
- authoritative broad security validation;
- production Secret Provider configuration;
- encryption at rest;
- durable Approval/Audit persistence;
- real OAuth or real GitHub/amoCRM/email/Telegram/Timeweb integration;
- production connector availability;
- production connector wiring;
- network validation;
- Linux validation;
- systemd validation;
- full L1–L5 orchestration;
- remote push.

Linux/systemd/full L1–L5 are **not required** for this closeout.

AUTHORITATIVE_SECURITY_VALIDATION=false

SECURITY_APPROVAL_COMPLETE=false

DEPLOYMENT_READY=false

ENCRYPTION_ENABLED=false

SECRET_PROVIDER_CONFIGURED=false

## Build identities

| Item | Value |
|------|-------|
| Build 3.5B base | `9ee5e8a28aa021e7fbc27add05b427d7b6cb37fa` |
| Design verdict | `BUILD_3_5A_CONNECTOR_PLATFORM_DESIGN_APPROVED_FOR_SINGLE_IMPLEMENTATION` |
| Primary implementation commit | `91f1cf64e1204e4a211b1eafe763139efd05fe53` |
| Primary implementation subject | `feat(connectors): add connector platform core and invocation pipeline` |
| Security corrective commit | `74c9637b2030460b1daf67d75e6f7dfb8c8bfae0` |
| Security corrective subject | `fix(connectors): enforce approval and invocation security boundaries` |
| Feature-branch closeout commit | `16bf1f4136641de4901218c721237b64ee1651fe` |
| Feature-branch closeout subject | `docs(connectors): close Build 3.5B connector platform core` |
| Approval clock corrective commit | `2237bd726eb1f65374d835e2584724718da325a5` |
| Approval clock corrective subject | `fix(connectors): use injected clock for approval expiry` |
| Local `main` HEAD | `2237bd726eb1f65374d835e2584724718da325a5` |
| Feature branch | `build-3-5b-connector-platform-core` |
| Feature branch HEAD | `16bf1f4136641de4901218c721237b64ee1651fe` (pending owner-directed synchronization) |
| package-lock SHA-256 | `f8b9ce9fdbf3dd1d69f219df2a997e58b1cd5abcb077312b5151ba729175db54` (unchanged) |
| Node | `v22.13.0` |
| npm | `10.9.2` |

## Initial independent review (blocked)

| Item | Value |
|------|-------|
| Verdict | `BLOCK_BUILD_3_5B_CONNECTOR_PLATFORM_CORE` |
| Final status | `BUILD_3_5B_CONNECTOR_PLATFORM_CORE_SOURCE_REVIEW_BLOCKED` |
| Reviewed baseline | `91f1cf64e1204e4a211b1eafe763139efd05fe53` |

The first implementation was **blocked**. Material findings:

| ID | Severity | Issue |
|----|----------|-------|
| CP-B01 | BLOCKER | Approval request was immediately consumable without a separate trusted grant decision |
| CP-H01 | HIGH | Executable `Connector` escaped the orchestrator boundary |
| CP-H02 | HIGH | Incorrect `number`/`integer` schema semantics |
| CP-H03 | HIGH | `NaN` and `Infinity` passed JSON bounds |
| CP-H04 | HIGH | Approving actor was not properly bound |
| CP-H05 | HIGH | Pre-aborted `AbortSignal` was ignored |
| CP-M01 | MEDIUM | Health key collision |
| CP-M02 | MEDIUM | Connector reason leakage |
| CP-M03 | MEDIUM | Late success after abort |
| CP-M04 | MEDIUM | Unbounded `accountIdentity` |
| CP-M05 | MEDIUM | Insufficient behavioural tests |
| CP-M06 | MEDIUM | Weakened connector boundary checker |

## Corrective implementation

### Approval security

- `ToolApprovalPort` exposes `request`/`consume` only;
- `ToolApprovalDecisionPort` is the separate trusted decision surface;
- pending approval is not executable;
- lifecycle:
  - `pending` → `granted` → `consumed`;
  - `pending` → `denied`;
  - `pending`/`granted` → `revoked`;
- approval IDs and nonces are nondeterministic;
- exact invocation/tool/connector/connection/input/side-effect/actor/expiry binding;
- grants are single-use;
- `FINANCIAL` remains impossible to approve or execute.

### Connector execution isolation

- public `ConnectorCatalog` exposes metadata only;
- executable `ConnectorExecutionRegistry` is private to orchestrator/application composition;
- no public `getConnector`/`execute` path;
- reference connector remains test/development-only;
- boundary rules protect direct paths, re-exports and supported alternate import specifiers.

### Numeric and JSON safety

- `number` accepts finite integer and fractional values;
- `integer` requires finite integral values;
- `NaN` and infinities rejected;
- inclusive minimum/maximum enforced;
- invalid numeric input cannot reach Policy, Secret Provider or connector;
- invalid numeric output cannot become success;
- canonical digest handles numeric input consistently.

### Cancellation and late completion

- pre-aborted request returns cancelled/not-started;
- no Secret Provider resolution or connector execution;
- abort/timeout wins over late success;
- late completion cannot overwrite health or success audit;
- write-like uncertain completion returns `outcome-unknown`;
- no automatic write retry;
- cooperative cancellation limitation remains documented honestly.

### Other MEDIUM remediation

- health registry uses collision-safe structured keys;
- connector free-form reason/body/stack is not exposed;
- `accountIdentity` is bounded and rejects unsafe credential/control patterns;
- boundary checker strictness restored;
- behavioural regression coverage expanded.

## Independent corrective re-review (security corrective)

| Item | Value |
|------|-------|
| Verdict | `APPROVE_WITH_NOTES_BUILD_3_5B_SECURITY_CORRECTIVE_FOR_CLOSEOUT` |
| Final status | `BUILD_3_5B_SECURITY_CORRECTIVE_SOURCE_REREVIEW_APPROVED_WITH_NOTES_FOR_CLOSEOUT` |
| Reviewed baseline | `74c9637b2030460b1daf67d75e6f7dfb8c8bfae0` |

### Finding disposition

| ID | Disposition |
|----|-------------|
| CP-B01 | CLOSED |
| CP-H01 | CLOSED |
| CP-H02 | CLOSED |
| CP-H03 | CLOSED |
| CP-H04 | CLOSED |
| CP-H05 | CLOSED |
| CP-M01 | CLOSED |
| CP-M02 | CLOSED |
| CP-M03 | CLOSED |
| CP-M04 | CLOSED |
| CP-M05 | CLOSED |
| CP-M06 | CLOSED |

No remaining BLOCKER/HIGH/MEDIUM findings from the security corrective review.

### Invariant proofs (I1–I20)

| ID | Result |
|----|--------|
| I1 | PASS |
| I2 | PASS |
| I3 | PASS |
| I4 | PASS |
| I5 | PASS |
| I6 | PASS |
| I7 | PASS |
| I8 | PASS |
| I9 | PASS |
| I10 | PASS |
| I11 | PASS |
| I12 | PASS |
| I13 | PASS |
| I14 | PASS |
| I15 | PASS |
| I16 | PASS |
| I17 | PASS |
| I18 | PASS |
| I19 | PASS |
| I20 | PASS |

Security corrective focused tests: **36/36 PASS**. Full suite at security corrective closeout:
**1752 passed**, 3 skipped.

## Fast-forward integration into local `main`

| Item | Value |
|------|-------|
| Pre-integration `main` HEAD | `9ee5e8a28aa021e7fbc27add05b427d7b6cb37fa` |
| Integration command | `git merge --ff-only build-3-5b-connector-platform-core` |
| Post-integration `main` HEAD | `16bf1f4136641de4901218c721237b64ee1651fe` |
| Merge commit created | **no** |
| SHA rewritten | **no** |
| Push performed | **no** |

`main` was a direct ancestor of the feature branch. The feature branch contained exactly three
Build 3.5B commits not in `main`:

1. `91f1cf64e1204e4a211b1eafe763139efd05fe53`
2. `74c9637b2030460b1daf67d75e6f7dfb8c8bfae0`
3. `16bf1f4136641de4901218c721237b64ee1651fe`

## Windows EOL diagnosis

| Item | Result |
|------|--------|
| Committed blobs/index EOL | LF |
| Initial Windows worktree EOL | CRLF (`core.autocrlf=true`) |
| Prettier expectation | LF |
| `main` and feature tree IDs | identical |
| Repository-content defect | **no** — worktree-materialization issue only |
| EOL corrective commit required | **no** |
| `.gitattributes` changed | **no** |
| Persistent Git config changed | **no** |

Post-integration `format:check` failed because the working tree was CRLF while committed blobs and
the index remained LF. This was resolved by worktree re-materialization as LF without changing
committed content, `.gitattributes`, or persistent Git configuration.

## Approval clock defect (post-integration postcheck)

Post-integration test run exposed four connector-platform failures:

- `ToolInvocationOrchestrator` generated `expiresAt` from the injected `ClockPort`;
- `InMemoryToolApprovalPort` evaluated expiry using `Date.now()`;
- fixed test time and real wall time belonged to different time domains;
- rerunning tests within an expiry window would only hide the defect.

## Approval clock corrective

| Item | Value |
|------|-------|
| Commit | `2237bd726eb1f65374d835e2584724718da325a5` |
| Subject | `fix(connectors): use injected clock for approval expiry` |
| Parent | `16bf1f4136641de4901218c721237b64ee1651fe` |

### Corrective properties

- `ClockPort` is mandatory for in-memory approval ports;
- grant and consume expiry checks use the injected clock;
- no direct `Date.now`, `new Date`, `performance.now` or uptime source remains in the approval
  lifecycle;
- valid only while `now < expiresAt`;
- equality (`now === expiresAt`) and later time are expired;
- malformed stored expiry fails closed;
- malformed clock fails closed;
- expired approval cannot resolve secrets or execute a connector;
- trusted decision gate, actor binding, randomness, single-use and `FINANCIAL` hard deny remain
  preserved.

### Expiry evaluation semantics

- expiry is evaluated when a trusted decision attempts to grant a pending request;
- expiry is evaluated when execution attempts to consume a granted approval;
- `createRequest` stores the requested expiry;
- deny and revoke are terminal state transitions and do not need an expiry evaluation to become more permissive;
- no expired approval can become executable.

## Focused independent re-review (approval clock corrective)

| Item | Value |
|------|-------|
| Verdict | `APPROVE_WITH_NOTES_BUILD_3_5B_APPROVAL_CLOCK_CORRECTIVE` |
| Final status | `BUILD_3_5B_APPROVAL_CLOCK_CORRECTIVE_REREVIEW_APPROVED_WITH_NOTES` |
| Reviewed baseline | `2237bd726eb1f65374d835e2584724718da325a5` |

### Finding disposition

| Category | Disposition |
|----------|-------------|
| BLOCKER | none |
| HIGH | none |
| MEDIUM | none |
| C1–C15 | PASS |
| Previously failing tests | PASS |

### Clock corrective invariant proofs (C1–C15)

| ID | Result |
|----|--------|
| C1 | PASS |
| C2 | PASS |
| C3 | PASS |
| C4 | PASS |
| C5 | PASS |
| C6 | PASS |
| C7 | PASS |
| C8 | PASS |
| C9 | PASS |
| C10 | PASS |
| C11 | PASS |
| C12 | PASS |
| C13 | PASS |
| C14 | PASS |
| C15 | PASS |

The reviewer did not mutate the repository.

## Test and verification evidence (final postcheck)

| Check | Result |
|-------|--------|
| Approval-clock and connector-platform focused tests | **47/47 PASS** |
| Full suite | **1771 passed**, 3 skipped |
| `npm run format:check` | PASS |
| `npm run typecheck` | PASS |
| `tsc --noEmit -p tsconfig.integration.json` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `npm run test:run` | PASS |
| `npm run check:connector-boundaries` | PASS |
| `npm run check:boundaries` | PASS |
| `npm run check:secrets` | PASS |
| `npm run check:hygiene` | PASS |
| `npm run check:systemd-template` | PASS |
| `npm run check:node` | PASS |
| `git diff --check` | PASS |
| `OPENCLAW_PRODUCTION_NODE_GATE=1 npm run check` | PASS |
| package-lock | unchanged |
| schema/migrations | unchanged |
| diagnostics | remain false |

## LOW/INFO backlog (non-blocking)

Do **not** convert these into security approval blockers for Build 3.5B.

### AC-L01 — Approval expiry evaluation wording

Prior LOW: documentation overstated that create/deny/revoke evaluate expiry. **CLOSED BY DOCUMENTATION CORRECTION** — honest semantics recorded above; implementation unchanged.

### AC-I01 — Orchestrator health timestamp

`ToolInvocationOrchestrator` uses `new Date()` for a health timestamp outside the approval
lifecycle. INFO only; not fixed in this closeout.

### AC-I02 — Financial test dead branch

A financial test contains a dead conditional branch after an expected failure assertion. INFO only;
not fixed in this closeout.

### CP-L01 — Audit-first vs resolve-first

Prior LOW: tool/connector resolve before invocation-requested audit. Unchanged; limited impact.

### CP-L03 — approvingActorId omitted from bindingsMatch

Orchestrator passes `approvingActorId:null`; consume requires stored non-null from grant. Not a
self-approval path.

### CP-L04 — No connector-boundary mutation fixtures

depcruise + allowlists + verify-connector-boundaries green; unlike memory isolation, no self-test
fixtures.

### CP-I01 — Cooperative cancellation only

Docs honest: ignoring `AbortSignal` is not hard-stopped.

## Completed platform components

- integrated into local `main`;
- architecture and in-memory TypeScript foundation complete;
- connector/tool manifests implemented;
- mandatory invocation orchestrator implemented;
- deny-by-default policy implemented;
- trusted-decision approval lifecycle implemented;
- safe bounded audit implemented;
- opaque Secret Provider interface implemented;
- in-memory registries implemented;
- deterministic offline reference connector implemented;
- all identified BLOCKER/HIGH/MEDIUM findings closed;
- approval clock corrective independently approved;
- full local postcheck green.

## Deferred production components

- production connector wiring absent;
- real connectors absent;
- production Secret Provider absent;
- durable approval/audit persistence absent;
- production deployment absent;
- push not performed.

The reference connector under `src/connectors/reference` is test/development-only and must not be
imported by production composition.

## Branch and integration status

- feature branch closeout completed on `build-3-5b-connector-platform-core` at
  `16bf1f4136641de4901218c721237b64ee1651fe`;
- fast-forward integration into local `main` completed at `16bf1f4136641de4901218c721237b64ee1651fe`
  via `git merge --ff-only`; no merge commit created; no SHA rewritten;
- approval clock corrective committed on `main` at `2237bd726eb1f65374d835e2584724718da325a5`;
- feature branch remains at `16bf1f4136641de4901218c721237b64ee1651fe` pending owner-directed
  synchronization;
- no merge, rebase, cherry-pick or push occurred in this closeout task.

## Final dispositions

### Approval clock corrective

`BUILD_3_5B_APPROVAL_CLOCK_CORRECTIVE_CLOSED_WITH_SINGLE_INJECTED_TIME_DOMAIN`

### Overall Build 3.5B

`BUILD_3_5B_CONNECTOR_PLATFORM_CORE_CLOSED_WITH_TRUSTED_APPROVAL_PRIVATE_EXECUTION_BOUNDED_DATA_AND_SAFE_INVOCATION_PIPELINE`
