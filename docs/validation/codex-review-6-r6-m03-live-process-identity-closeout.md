# Codex Review №6 — R6-M03 live process identity-bound readiness closeout

## Scope

This record closes **only** Codex Review №6 finding **R6-M03** for binding readiness and status
to the exact live Neo process instance on supported Linux procfs.

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
- resolution of R6-L01–R6-L04, deferred systemd hardening, or online dependency review.

Evidence paths were temporary local disposable artifacts and are **not** repository artifacts.
This record stores hashes and result summaries only, not volatile absolute user paths.

AUTHORITATIVE_SECURITY_VALIDATION=false

NONAUTHORITATIVE_R6_M03_LINUX_PROCFS_REGRESSION=true

FULL_LINUX_L1_L5_RUN=false

SYSTEMD_REGRESSION_RUN=false

## Finding

| Field | Value |
|-------|-------|
| ID | R6-M03 |
| Original severity | MEDIUM |
| Trust boundary | readiness publication → `ready.json` → status CLI → operator liveness decision |
| Original false-ready path | 1) readiness schema v1 stored PID only; 2) status trusted schema-valid `ready.json`; 3) no process existence check; 4) no PID-reuse protection; 5) no boot identity; 6) no process start identity; 7) no zombie/dead-state rejection; 8) abrupt death could leave stale readiness producing `ready:true` |

## Source implementation

### Primary implementation

| Field | Value |
|-------|-------|
| Implementation commit | `eee734a2e4d4a5e0689c2e039dfa04d18e4d8880` |
| Subject | `fix(neo-runtime): bind readiness to the live process instance` |
| Parent | `6e119ebc903a49be0e2da074766388bb5549201b` |

### Corrective implementation

| Field | Value |
|-------|-------|
| Implementation commit | `7a1fbbd52b3ad4145955139c469c2e31fa4660f5` |
| Subject | `fix(neo-runtime): harden procfs reads and verified status snapshots` |
| Parent | `eee734a2e4d4a5e0689c2e039dfa04d18e4d8880` |
| Package-lock SHA-256 | `f8b9ce9fdbf3dd1d69f219df2a997e58b1cd5abcb077312b5151ba729175db54` (unchanged) |

### Remediation guarantees

- readiness schema version **2**;
- required PID;
- required Linux boot ID;
- required process start-time ticks stored as decimal string;
- process state read from `/proc/<pid>/stat`;
- PID reuse rejected through start-ticks mismatch;
- reboot/restored record rejected through boot-ID mismatch;
- absent process rejected;
- Z and X process states rejected;
- schema v1 never accepted as ready;
- malformed or unavailable identity fails closed;
- publisher cannot publish readiness without valid process identity;
- status uses one verified readiness snapshot;
- status remains read-only;
- no process-lock or SQLite interaction by status;
- atomic readiness publication preserved;
- R6-H01 shutdown-latch protection preserved;
- systemd template unchanged;
- Node launcher gate unchanged;
- package-lock unchanged;
- diagnostics unchanged.

## Independent source review history

### Initial independent source review

| Item | Value |
|------|-------|
| Verdict | `BLOCK_R6_M03` |
| Final status | `R6_M03_INDEPENDENT_SOURCE_REVIEW_BLOCKED` |
| BLOCKER-01 | `R6_M03_PROCFS_SIZE_TRUSTED_EMPTY_READ` — bounded procfs reader trusted `st_size`; procfs seq_file often reports `0` → empty read → permanent fail-closed on Linux |
| MEDIUM-01 | `R6_M03_STATUS_DOUBLE_READ_SKIPS_REVERIFY` — status verified document A then re-read document B without re-verification → TOCTOU bypass |
| LOW-01 | exact start-ticks test weakness |
| LOW-02 | missing state-X status coverage |

### Corrective independent re-review

| Item | Value |
|------|-------|
| Verdict | `APPROVE_WITH_NOTES_R6_M03_CORRECTIVE_SOURCE_FOR_FOCUSED_LINUX_READINESS_IDENTITY_REGRESSION` |
| Final status | `R6_M03_CORRECTIVE_SOURCE_REREVIEW_APPROVED_WITH_NOTES_FOR_FOCUSED_LINUX_REGRESSION` |
| BLOCKER-01 | CLOSED |
| MEDIUM-01 | CLOSED |
| LOW-01 | CLOSED |
| LOW-02 | CLOSED |
| P1–P18 | PASS at source level |
| BLOCKER / HIGH / MEDIUM / LOW | none remained at source/test level |
| Focused Linux regression | required and completed separately |

### INFO notes (non-blocking backlog)

#### R6-M03-INFO-01

State **X** can map through different bounded not-ready reasons depending on probe path.

Disposition: both paths remain fail-closed; no `ready:true` path; optional documentation-only
clarification backlog.

#### R6-M03-INFO-02

Post-verification process death remains an unavoidable point-in-time race.

Disposition: status is point-in-time by design; abrupt-death stale readiness is covered by focused
regression; not a reopening of R6-M03.

Do **not** convert INFO notes into new Review №6 findings.

## Focused Linux regression

| Item | Value |
|-------|-------|
| Final status | `R6_M03_FOCUSED_LINUX_READINESS_IDENTITY_REGRESSION_PASSED_READY_FOR_SECURITY_FINDING_CLOSEOUT` |
| Environment | Ubuntu 24.04.4 LTS WSL2; kernel `6.18.33.2-microsoft-standard-WSL2`; real procfs; Node `v22.13.0`; npm `10.9.2` |
| Source commit | `7a1fbbd52b3ad4145955139c469c2e31fa4660f5` |
| Dependencies | offline Build 3.4F payload (non-authoritative image label; exact lock verified in regression) |
| Disposable environment | unregistered after evidence capture |
| Scope note | Not production deployment; not VPS deployment; non-authoritative disposable proof |
| Manifest | OK=**93**; FAIL=**0** |
| Manifest SHA-256 | `ace16a4e3474de4596b8b253e1711d30bcd3ee43b8ac892ca9c411edcda95e3a` |

### Real procfs size-zero proof

| Path | Reported `st_size` | Readable bytes |
|------|-------------------|----------------|
| `/proc/self/stat` | 0 | 301 |
| `/proc/sys/kernel/random/boot_id` | 0 | 37 |

Production bounded reader handled both correctly independently of reported size.

### Live process proof

| Check | Result |
|-------|--------|
| Launcher | exact production `scripts/neo/start-neo.mjs` |
| Live Neo PID | **869** |
| Readiness `schemaVersion` | **2** |
| Readiness PID vs live PID | **869** = **869** |
| Readiness `bootId` vs kernel boot ID | `c79e9c17-8265-47a0-b983-06f1dbfdf241` match |
| Readiness `startTimeTicks` vs `/proc/869/stat` field 22 | `2728` = `2728` (decimal text) |
| Live process state | **S** (not Z/X) |
| Status CLI | exit **0**, `ready:true` |
| Status read-only | `ready.json` unchanged |

### Mismatch proofs

| Scenario | Exit | `ready` | `reason` | File mutation |
|----------|------|---------|----------|---------------|
| Modified `startTimeTicks` only | **1** | false | `process-identity-mismatch` | none |
| Modified `bootId` only | **1** | false | `process-boot-mismatch` | none |

### Abrupt-death stale proof

| Check | Result |
|-------|--------|
| Kill method | SIGKILL to exact Neo PID (not cooperative SIGTERM) |
| Process after kill | absent; no replacement; no zombie |
| Stale `ready.json` | intentionally retained |
| Stale status | exit **1**, `ready:false`, `process-absent` |
| Readiness hash/size/mtime/mode | unchanged by status |
| Process lock | unchanged by status |
| SQLite / WAL / SHM | unchanged by status |
| Durable-root inventory | unchanged by status |

## Security proofs (P1–P18)

| Proof | Result |
|-------|--------|
| P1 exact process binding | PASS |
| P2 PID reuse resistance | PASS |
| P3 reboot resistance | PASS |
| P4 dead-process rejection | PASS |
| P5 zombie/dead rejection | PASS |
| P6 legacy fail-closed | PASS |
| P7 malformed fail-closed | PASS |
| P8 probe errors fail-closed | PASS |
| P9 publisher refuses unbound readiness | PASS |
| P10 atomic publication preserved | PASS |
| P11 R6-H01 preserved | PASS |
| P12 status read-only | PASS |
| P13 no process-lock disturbance | PASS |
| P14 supported Linux compatibility proven in focused regression | PASS |
| P15 diagnostics remain false | PASS |
| P16 no supported raw-readiness bypass | PASS |
| P17 start ticks remain precision-safe | PASS |
| P18 production cannot silently use fake provider | PASS |

## Linux disposition

FOCUSED_LINUX_READINESS_IDENTITY_REGRESSION_PASSED

FULL_LINUX_L1_L5_RUN=false

FULL_LINUX_L1_L5_NOT_REQUIRED=true

SYSTEMD_REGRESSION_RUN=false

Reason:

- remediation targeted readiness/status identity binding and procfs bounded reads only;
- production launcher, systemd template, Node gate, durable owner, and process-lock design were
  unchanged;
- focused disposable Ubuntu procfs regression exercised live publication, verified status, mismatch
  rejection, and stale rejection directly;
- full L1–L5 orchestration and systemd regression were not required for this finding closure.

## Claim boundary

### Closed within this finding

- stale readiness accepted for dead process;
- PID-only process identity;
- PID reuse false positive;
- reboot/restored-file false positive;
- zombie/dead process accepted;
- schema v1 accepted as ready;
- identity-probe failures producing ready;
- publisher emitting unbound readiness;
- procfs `st_size` zero handling failure;
- ready output from a second unverified document;
- supported raw-readiness operational bypass.

### Not closed

- R6-L01 — config lstat/open TOCTOU;
- R6-L02 — readiness temporary-file exclusive/no-follow hardening;
- R6-L03 — broad integration-event verification;
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

R6-M03 does **not** close:

1. **R6-L01** — config lstat/open TOCTOU (**next highest priority**)
2. **R6-L02** — readiness temp-file exclusive/no-follow hardening
3. **R6-L03** — integration event verification is too broad
4. **R6-L04** — group-readable unencrypted state
5. deferred systemd security hardening
6. online dependency/provenance review

Codex Review №6 as a whole remains **blocked** pending remediation of remaining findings,
starting with **R6-L01**.

## Final R6-M03 disposition

**R6_M03_SECURITY_FINDING_CLOSED_WITH_LIVE_PROCESS_IDENTITY_BOUND_READINESS**

This does **not** mean overall Codex Review №6 is complete.

SECURITY_APPROVAL_COMPLETE=false

DEPLOYMENT_READY=false

SECRET_PROVIDER_CONFIGURED=false

ENCRYPTION_ENABLED=false

AUTHORITATIVE_SECURITY_VALIDATION=false
