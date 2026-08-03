# Codex Review №6 — R6-M02 production Node gate and systemd exit-3 non-restart closeout

## Scope

This record closes **only** Codex Review №6 finding **R6-M02** for mandatory pre-import Node
runtime enforcement in the production launcher and systemd non-restart behavior for unsupported
runtime exit **3**.

This record does **not** establish:

- overall Codex Review №6 pass;
- `securityApprovalComplete=true`;
- `deploymentReady=true`;
- production deployment;
- VPS deployment;
- authoritative broad security validation;
- Secret Provider configuration;
- encryption at rest;
- durable Approval/Audit readiness;
- channel/connector readiness;
- resolution of R6-M03, R6-L01–R6-L04, deferred systemd hardening, or online dependency review.

Evidence paths were temporary local disposable artifacts and are **not** repository artifacts.
This record stores hashes and result summaries only, not volatile absolute user paths.

AUTHORITATIVE_SECURITY_VALIDATION=false

NONAUTHORITATIVE_R6_M02_SYSTEMD_REGRESSION=true

FULL_LINUX_L1_L5_RUN=false

## Finding

| Field | Value |
|-------|-------|
| ID | R6-M02 |
| Original severity | MEDIUM |
| Trust boundary | host Node executable → production launcher → application import graph → config/native/durable bootstrap → readiness and process lifetime |
| Original bypass | 1) `package.json` declared `>=22.13.0 <23`; 2) `check:node` verified it in CI/tooling; 3) strict aggregate verification used `OPENCLAW_PRODUCTION_NODE_GATE=1`; 4) systemd and operators launched `scripts/neo/start-neo.mjs` directly with `/usr/bin/node`; 5) the launcher imported the compiled Neo process module without checking Node; 6) npm engines and CI checks did not protect direct production invocation; 7) unsupported Node could evaluate config/runtime/native/durable modules before failure; 8) readiness, process lock and SQLite could potentially be reached |

## Canonical contract

| Item | Value |
|------|-------|
| Production range | `>=22.13.0 <23` |
| Authority | dependency-free canonical JavaScript helper `scripts/lib/node-version-contract.mjs` |
| CI/runtime parity | `check:node` and production launcher share the same helper |
| npm runtime requirement | none for production launcher gate |
| Runtime opt-in | gate does not depend on `OPENCLAW_PRODUCTION_NODE_GATE`, review override, or npm |

## Source implementation

| Field | Value |
|-------|-------|
| Implementation commit | `6427a34b07ef9a4b031cafa9737d660a2fc265b4` |
| Subject | `fix(neo-runtime): enforce Node runtime contract in production launcher` |
| Parent | `893c2adb93b19bbbfb5157d067a88376693cfaa2` |
| Package-lock SHA-256 | `f8b9ce9fdbf3dd1d69f219df2a997e58b1cd5abcb077312b5151ba729175db54` (unchanged) |
| Host systemd-template SHA-256 | `795790dbc95414116de0ebcbccdd850681f863c84a3c43ffc34b7d6699d71fb6` |
| Git/LF template SHA-256 | `b09c55091ba2732c685769a373a416371f422adf09547f56c56e5178a0b1470f` |

### Source guarantees

- dependency-free canonical JavaScript Node contract helper;
- production launcher always validates `process.versions.node` before dynamic import;
- unsupported or malformed runtime fails before importing compiled Neo runtime;
- unsupported runtime uses existing exit code **3**;
- bounded stderr contains range and observed version only; no stack, environment dump, config path
  or secret;
- supported runtime dynamically imports runtime exactly once;
- direct compiled process module remains unsupported as an operational launcher;
- systemd `ExecStart` remains `/usr/bin/node .../scripts/neo/start-neo.mjs`;
- `RestartPreventExitStatus=10 3`; no `ExecStartPre`;
- status CLI `scripts/neo/neo-status.mjs` remains intentionally ungated;
- package-lock, schema, diagnostics and Neo lifecycle composition unchanged.

## Independent source review

| Item | Value |
|------|-------|
| Verdict | `APPROVE_WITH_NOTES_R6_M02_SOURCE_FOR_FOCUSED_SYSTEMD_REGRESSION` |
| Final status | `R6_M02_INDEPENDENT_SOURCE_REVIEW_APPROVED_WITH_NOTES_FOR_FOCUSED_SYSTEMD_REGRESSION` |
| Parent bypass | confirmed real; MEDIUM justified |
| Supported launcher bypass | none remains |
| Gate ordering | before runtime/config/native imports |
| Environment override bypass | none |
| BLOCKER / HIGH / MEDIUM | none at source/test level |
| Focused systemd regression | required and completed separately |

### INFO notes (non-blocking backlog)

#### R6-M02-INFO-01

Malformed injected version text is not explicitly truncated by the formatter.

Disposition: production source is `process.versions.node`, which is bounded; no production exploit
path found; optional formatting-hardening backlog.

#### R6-M02-INFO-02

Parser accepts numeric components with leading zeros.

Disposition: such values do not occur in normal `process.versions.node`; does not weaken the actual
production gate; optional parser-hardening backlog.

#### R6-M02-INFO-03

A Build 3.4 validation-record contract test now expects `RestartPreventExitStatus=10 3`, while
historical Build 3.4F live evidence covered only `10`.

Disposition: historical evidence must not be rewritten; this focused systemd regression is the live
evidence for exit **3** non-restart behavior.

#### R6-M02-INFO-04

Some documentation phrased systemd non-restart as a fact while live regression was still pending.

Disposition: focused systemd regression has now completed; this closeout records the bounded result
as proven in the disposable environment; does not claim production/VPS validation.

Do **not** convert INFO notes into new Review №6 findings.

## Security proofs (N1–N15)

| Proof | Result |
|-------|--------|
| N1 supported production launcher always gates | PASS |
| N2 no runtime opt-in bypass | PASS |
| N3 gate precedes application/runtime imports | PASS |
| N4 gate precedes config/native/durable side effects | PASS |
| N5 CI and runtime share the canonical contract | PASS |
| N6 no supported lower-level production entrypoint bypass | PASS |
| N7 unsupported and malformed failures are deterministic and bounded | PASS |
| N8 Node 22.13.0 and later Node 22 compatibility preserved | PASS |
| N9 production launcher requires no npm | PASS |
| N10 unsupported runtime cannot publish readiness | PASS |
| N11 diagnostics remain false | PASS |
| N12 status CLI decision is explicit and non-bypassing | PASS |
| N13 exit code 3 propagates through the launcher to systemd | PASS |
| N14 systemd suppresses restart for status 3 | PASS |
| N15 package-lock and dependencies remain unchanged | PASS |

## Systemd evidence history

Focused disposable Ubuntu 24.04 / systemd **255.4** regressions. Not production deployment. Not
authoritative broad security validation.

### 1. Supported scenario — PASS (first combined run)

| Item | Value |
|------|-------|
| Source commit | `6427a34b07ef9a4b031cafa9737d660a2fc265b4` |
| Environment | Ubuntu 24.04.4 LTS; cgroup v2; PID 1 systemd |
| Node | `/usr/bin/node` v22.13.0 |
| Launcher | exact production `scripts/neo/start-neo.mjs` |
| Gate | accepted 22.13.0 |
| Service | active/ready |
| Readiness | valid readiness file; `runtimeReady=true` |
| Restarts | `NRestarts=0` |
| Status CLI | usable |
| Stop | cooperative stop succeeded; readiness removed after stop |
| Cleanup | unit/runtime roots cleaned |
| Prior evidence inventory | 51 files |
| Prior inventory SHA-256 | `b94004304f12ca7c538db452726f2015a5e00164f64ffc41a7d0b05d577c5a80` |

### 2. First unsupported companion attempt — harness failure (not source failure)

In the same first combined run, the unsupported companion harness failed **before** Node execution:

| Item | Value |
|------|-------|
| Failure class | temporary execution-harness failure |
| systemd result | `226/NAMESPACE` |
| Cause | companion unit `ReadWritePaths` referenced absent `/var/tmp` counters path |
| Wrapper invocations | 0 |
| Exit 3 reached | no |
| `NRestarts` | 2 (harness/systemd namespace failure; not launcher exit **3** evidence) |
| Valid exit-3 evidence | **no** |
| Automatic retry in that run | no |

This is **not** a source remediation failure and must not be merged into successful unsupported
evidence.

### 3. Focused unsupported rerun — PASS (authoritative exit-3 evidence)

| Item | Value |
|------|-------|
| Final status | `R6_M02_FOCUSED_SYSTEMD_UNSUPPORTED_RERUN_PASSED_READY_FOR_SECURITY_FINDING_CLOSEOUT` |
| Environment | Ubuntu 24.04.4 LTS WSL2; systemd 255.4; cgroup v2; PID 1 systemd |
| Node | v22.13.0; npm 10.9.2; offline Build 3.4F dependencies |
| Source commit | `6427a34b07ef9a4b031cafa9737d660a2fc265b4` |
| Scenario | exact production `launchNeoProcess` helper; synthetic Node version `23.0.0`; importer
  sentinel; no production config; no runtime import; no credentials |
| Companion unit | exact relevant restart semantics; `RestartPreventExitStatus=10 3` |
| Synthetic wrapper SHA-256 | `3507c9a8033f20ddaa7ebe0602fb3e79c5463fe569512223cd16b479b2687872` |
| Companion unit SHA-256 | `95428b518a71acd819ebebd5d45d0b0cb04f3801175b069a33e8b1be470fbc25` |
| Wrapper invocations | exactly **1** |
| Importer sentinel | absent |
| stderr | `Node 23.0.0 is outside the production support range >=22.13.0 <23.` |
| `ExecMainCode` | `1` (`CLD_EXITED` / normal process exit; **not** application exit status 1) |
| `ExecMainStatus` | `3` (application exit code) |
| `Result` | `exit-code` |
| `ActiveState` | `failed` |
| `SubState` | `failed` |
| `MainPID` | `0` |
| Invocation IDs | one |
| `NRestarts` | `0` |
| Scheduled restart | none |
| Restart loop after 12 seconds | none |
| Evidence manifest | OK=50; FAIL=0 |
| Manifest SHA-256 | `4766988d0505478cf9310c1c139c6f1984fe673e1ba8d0389660b69ef7b74be5` |
| Combined closure index | disposable combined-closure-index artifact for unsupported rerun |
| Second authoritative `systemctl start` | **no** |
| Harness false-negative correction | semantic interpretation only on already captured evidence |

## Systemd exit semantics

For unsupported runtime exit **3**:

- `ExecMainCode=1` means systemd observed `CLD_EXITED` (normal process termination);
- `ExecMainStatus=3` is the actual application exit code from the launcher gate;
- `RestartPreventExitStatus=10 3` suppresses automatic restart for status **3**;
- `NRestarts=0` after the authoritative unsupported rerun;
- no restart loop was observed after 12 seconds.

The harness initially treated `ExecMainCode=1` as a false negative, then reevaluated already
captured evidence without issuing another `systemctl start`.

## Artifact isolation (unsupported rerun)

| Artifact | Result |
|----------|--------|
| readiness file | absent |
| process lock | absent |
| SQLite / WAL / SHM | absent |
| durable-root mutation | absent |
| config/channel activity | absent |
| process residue | none |
| unit and disposable artifacts | cleaned |
| disposable Ubuntu | unregistered |
| host repository | unchanged |

## Status CLI

`scripts/neo/neo-status.mjs` remains intentionally ungated for emergency diagnostics.

During unsupported rerun with absent readiness:

- neo-status returned `{"ready":false,"reason":"readiness-absent"}`;
- status CLI exit **1**;
- this disposition is explicit and does not bypass the production launcher gate.

## Combined R6-M02 proof

Together, supported and unsupported disposable scenarios prove:

### Supported path

- Node 22.13.0 accepted;
- production launcher/runtime importer reached;
- service active and ready;
- status CLI usable;
- normal cooperative cleanup.

### Unsupported path

- synthetic Node 23.0.0 rejected by the exact launcher helper;
- runtime importer never invoked;
- process exits with application status **3**;
- systemd records status **3**;
- `RestartPreventExitStatus=10 3` suppresses restart;
- `NRestarts=0`;
- no runtime/durable side effects;
- status CLI remains usable;
- cleanup complete.

## Test and verification evidence

| Check | Result |
|-------|--------|
| Independent source review | `R6_M02_INDEPENDENT_SOURCE_REVIEW_APPROVED_WITH_NOTES_FOR_FOCUSED_SYSTEMD_REGRESSION` |
| Full suite at source review | **1571 passed**, 3 skipped |
| `OPENCLAW_PRODUCTION_NODE_GATE=1 npm run check` | PASS at source review |
| package-lock | unchanged |
| schema/migrations | unchanged |
| diagnostics | unchanged |

## Linux disposition

FOCUSED_SYSTEMD_REGRESSION_PASSED

FULL_LINUX_L1_L5_RUN=false

FULL_LINUX_L1_L5_NOT_REQUIRED=true

Reason:

- runtime lifecycle and durable composition were not changed;
- only the pre-import Node gate and systemd non-restart status were under remediation;
- supported production launcher and unsupported systemd behavior were tested directly;
- full process orchestration was not redesigned.

## Claim boundary

### Closed within this finding

- production launcher bypass of the Node runtime contract;
- absence of mandatory runtime enforcement;
- dependence on CI/npm engines alone for runtime safety;
- environment opt-in bypass;
- application/runtime import before version decision;
- config/native/durable bootstrap before version decision;
- unsupported runtime reaching readiness/process lock/SQLite;
- unsupported runtime exit-code propagation to systemd;
- systemd restart loop for unsupported-runtime exit **3**;
- drift between CI and launcher JavaScript version authority;
- supported production launcher topology;
- deliberate ungated status CLI disposition.

### Not closed

- R6-M03 — readiness/status is not bound to a live process identity;
- R6-L01 — config lstat/open TOCTOU;
- R6-L02 — readiness temp-file exclusive/no-follow hardening;
- R6-L03 — broad integration event verification;
- R6-L04 — group-readable unencrypted state;
- deferred systemd hardening;
- online dependency/provenance review;
- production/VPS deployment;
- broad security approval.

## Diagnostics and readiness state

No diagnostics values changed for this closeout.

Still false:

- `deploymentReady`
- `securityApprovalComplete`
- `secretProviderConfigured`
- `encryptionEnabled`
- durable Approval port
- durable Audit port
- channel/connector readiness

## Open findings (Codex Review №6)

R6-M02 does **not** close:

1. **R6-M03** — readiness/status is not bound to live process identity (**next highest priority**)
2. **R6-L01** — config lstat/open TOCTOU
3. **R6-L02** — readiness temp-file exclusive/no-follow hardening
4. **R6-L03** — integration event verification is too broad
5. **R6-L04** — group-readable unencrypted state
6. deferred systemd security hardening
7. online dependency/provenance review

Codex Review №6 as a whole remains **blocked** pending remediation of remaining findings,
starting with **R6-M03**.

## Final R6-M02 disposition

**R6_M02_SECURITY_FINDING_CLOSED_WITH_PREIMPORT_NODE_GATE_AND_SYSTEMD_EXIT3_NONRESTART_PROOF**

This does **not** mean overall Codex Review №6 is complete.

SECURITY_APPROVAL_COMPLETE=false

DEPLOYMENT_READY=false

SECRET_PROVIDER_CONFIGURED=false

ENCRYPTION_ENABLED=false

AUTHORITATIVE_SECURITY_VALIDATION=false
