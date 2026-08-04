# Build 3.5B — Connector Platform Core closeout

## Scope

This record closes **Build 3.5B — Connector Platform Core** on feature branch
`build-3-5b-connector-platform-core` after the primary implementation commit and the security
corrective package. It records the initial blocked independent review, corrective remediation,
corrective re-review approval, and feature-branch closeout disposition.

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
- integration into `main`.

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
| Closeout baseline HEAD | `74c9637b2030460b1daf67d75e6f7dfb8c8bfae0` |
| Branch | `build-3-5b-connector-platform-core` |
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

## Independent corrective re-review

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

No remaining BLOCKER/HIGH/MEDIUM findings.

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

## Test and verification evidence

| Check | Result |
|-------|--------|
| Focused connector platform security tests | **36/36 PASS** |
| Full suite | **1752 passed**, 3 skipped |
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

- architecture and in-memory TypeScript foundation complete;
- connector/tool manifests implemented;
- mandatory invocation orchestrator implemented;
- deny-by-default policy implemented;
- trusted-decision approval lifecycle implemented;
- safe bounded audit implemented;
- opaque Secret Provider interface implemented;
- in-memory registries implemented;
- deterministic offline reference connector implemented.

## Deferred production components

- production connector wiring absent;
- real connectors absent;
- production Secret Provider absent;
- durable approval/audit persistence absent.

The reference connector under `src/connectors/reference` is test/development-only and must not be
imported by production composition.

## Branch and integration status

- feature branch closeout completed on `build-3-5b-connector-platform-core`;
- transfer/integration into `main` remains a separate owner-directed Git operation;
- no merge, rebase, cherry-pick or push occurred in this closeout task.

## Final Build 3.5B disposition

`BUILD_3_5B_CONNECTOR_PLATFORM_CORE_CLOSED_WITH_TRUSTED_APPROVAL_PRIVATE_EXECUTION_BOUNDED_DATA_AND_SAFE_INVOCATION_PIPELINE`
