# Codex Review №6 — R6 LOW filesystem hardening package closeout

## Scope

This record closes Codex Review №6 findings **R6-L01**, **R6-L02**, **R6-L03**, and **R6-L04** as one
bounded LOW hardening package (descriptor-safe config read, exclusive readiness temporary files,
exact integration-event correlation, and owner-only Neo state permissions).

This record does **not** establish:

- overall Codex Review №6 pass;
- `securityApprovalComplete=true`;
- `deploymentReady=true`;
- production or VPS deployment;
- authoritative broad security validation;
- Secret Provider configuration;
- encryption at rest;
- durable Approval/Audit readiness;
- channel/connector readiness;
- full Linux L1–L5 orchestration;
- systemd regression completion;
- complete online dependency/provenance review;
- resolution of deferred systemd hardening or non-blocking INFO/LOW backlog items outside this
  package.

Evidence paths were temporary local disposable artifacts and are **not** repository artifacts.
This record stores hashes and result summaries only, not volatile absolute user paths.

AUTHORITATIVE_SECURITY_VALIDATION=false

NONAUTHORITATIVE_R6_LOW_FILESYSTEM_REGRESSION=true

FULL_LINUX_L1_L5_RUN=false

SYSTEMD_REGRESSION_RUN=false

SECURITY_APPROVAL_COMPLETE=false

DEPLOYMENT_READY=false

ENCRYPTION_ENABLED=false

SECRET_PROVIDER_CONFIGURED=false

## Findings closed (package)

| ID | Original severity | Original issue |
|----|-------------------|----------------|
| R6-L01 | LOW | Config `lstat`/open TOCTOU — pathname open after pre-check without `O_NOFOLLOW` authority |
| R6-L02 | LOW | Readiness temp used predictable naming without exclusive/no-follow creation semantics |
| R6-L03 | LOW | Integration evidence assertions were too broad (runId/role/order not exact) |
| R6-L04 | LOW | Sensitive Neo-created state was group-readable by default |

## Design and implementation history

| Item | Value |
|------|-------|
| Design verdict | `R6_LOW_HARDENING_PACKAGE_DESIGN_APPROVED_FOR_SINGLE_IMPLEMENTATION` |
| Implementation commit | `486403811250651e0e547237c2acdc5be29ee63b` |
| Implementation subject | `fix(security): harden config, readiness, evidence and state boundaries` |
| Implementation parent | `39ddc657b3cf650ef5edc6a356b1a840ae893cd3` |
| TC01 corrective commit | `5aef38a9b989198e37d51f5a237e74cb4378e714` |
| TC01 subject | `fix(test): place correlation test in integration typecheck graph` |
| Fixture corrective commit | `6309432d06a8db2bce463a5cf87f865470af7aae` |
| Fixture subject | `fix(test): use real paths in config descriptor fixtures` |
| Package-lock SHA-256 | `f8b9ce9fdbf3dd1d69f219df2a997e58b1cd5abcb077312b5151ba729175db54` (unchanged across package) |

### R6-L01 remediation (production)

- production Linux config open uses `O_RDONLY | O_NOFOLLOW`;
- opened descriptor is the security authority;
- `fstat` validates the opened object;
- regular-file and canonical size limits enforced;
- bounded read occurs through the same descriptor;
- no pathname reopen after descriptor validation;
- descriptor closes on every post-open path;
- final-component symlinks fail closed;
- intermediate ancestor-symlink replacement race remains documented **INFO** backlog — not part of
  this closure.

### R6-L02 remediation (production)

- random 128-bit temporary suffix (32 hex chars);
- `O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW` on Linux;
- temporary mode `0600`;
- bounded `EEXIST` retries (`NEO_READINESS_TEMP_MAX_ATTEMPTS = 5`);
- attacker-controlled candidate regular files and symlinks are not modified or deleted;
- `fsync`, `close`, and atomic `rename` preserved;
- only publisher-owned temp cleanup on failure paths;
- R6-H01 shutdown latch preserved;
- R6-M03 schema-v2 process identity preserved.

### R6-L03 remediation (production/tests)

- integration evidence checks exact event type;
- exact `runId` and role/session correlation;
- exact lifecycle order;
- foreign, unrelated, and wrongly ordered events cannot produce PASS;
- failure output names the exact missing expectation;
- no Event Registry redesign.

### R6-L04 remediation (production)

- Linux Neo process applies `umask 0077` before sensitive state creation;
- app-managed sensitive directories owner-only;
- readiness and process lock `0600`;
- SQLite DB/WAL/SHM owner-only when present;
- no mode widening by status;
- encryption remains disabled and deferred;
- systemd template unchanged.

## Independent source review history

### Initial package source review

| Item | Value |
|------|-------|
| Verdict | `BLOCK_R6_LOW_HARDENING_SOURCE` |
| Only blocking finding | **R6-L-TC01** — package-caused main TypeScript TS5097 (correlation test in wrong typecheck graph) |
| Production R6-L01–L04 | approved at source level before TC01 blocker |

### TC01 corrective disposition

| Item | Value |
|------|-------|
| Corrective commit | `5aef38a9b989198e37d51f5a237e74cb4378e714` |
| Production R6-L01–L04 source | unchanged by TC01 correction |
| Main typecheck | PASS |
| Integration typecheck | PASS |
| Aggregate check | PASS |

### Corrective independent re-review

| Item | Value |
|------|-------|
| Verdict | `APPROVE_R6_LOW_HARDENING_CORRECTIVE_SOURCE_FOR_FOCUSED_LINUX_FILESYSTEM_REGRESSION` |
| Final status | `R6_LOW_HARDENING_CORRECTIVE_SOURCE_REREVIEW_APPROVED_FOR_FOCUSED_LINUX_REGRESSION` |
| BLOCKER / HIGH / MEDIUM / LOW / INFO | none new at source level after TC01 correction |

## Linux regression history

### First focused Linux run (fixture-only failure — not a production defect)

| Item | Value |
|------|-------|
| Source HEAD | `5aef38a9b989198e37d51f5a237e74cb4378e714` |
| Final status | `R6_LOW_HARDENING_FOCUSED_LINUX_FILESYSTEM_REGRESSION_NEXT_FAILURE_IDENTIFIED` |
| Class | `BUILD` (focused vitest before live scenarios) |
| Cause | test-only fake/nonexistent config pathnames; Linux `hasSymlinkInPath` fail-closed before injected `openDriver`; **no production security defect established** |
| Failing cases | `accepts exactly the maximum allowed size`; `closes descriptor after success and validation failure` |

### Test-fixture corrective

| Item | Value |
|------|-------|
| Commit | `6309432d06a8db2bce463a5cf87f865470af7aae` |
| Status | `R6_LOW_CONFIG_FIXTURE_CORRECTIVE_COMMITTED_READY_FOR_SINGLE_LINUX_RERUN` |
| Scope | test-only; production hardening unchanged |

### Successful focused Linux rerun

| Item | Value |
|------|-------|
| Source HEAD | `6309432d06a8db2bce463a5cf87f865470af7aae` |
| Final status | `R6_LOW_HARDENING_FOCUSED_LINUX_FILESYSTEM_REGRESSION_PASSED_READY_FOR_PACKAGE_CLOSEOUT` |
| Environment | Ubuntu 24.04.4 LTS WSL2; kernel `6.18.33.2-microsoft-standard-WSL2`; real Linux filesystem and procfs; Node `v22.13.0`; npm `10.9.2`; disposable environment unregistered after evidence |
| Focused preflight | **30/30 PASS** (config descriptor **12/12**; prior max-size and close-path failures closed) |
| Manifest | OK=**87**; FAIL=**0** |
| Manifest SHA-256 | `97d97c3f692098d15874a1046b8bc8d20c4ae340d6087be7f483d178556e7b25` |

### L01 Linux evidence

- valid regular config accepted;
- final-component symlink rejected (`ELOOP` / no-follow behavior);
- FIFO and directory rejected as non-regular;
- oversized config rejected;
- config content marker not leaked in bounded errors;
- handle cleanup confirmed.

Deterministic replacement-race proof for intermediate ancestor symlinks remains source/test
evidence; live run proved real `O_NOFOLLOW` and descriptor authority.

### L02 Linux evidence

- live schema-v2 readiness published;
- temp names use 32-hex random suffix (not PID-only);
- final `ready.json` mode **0600**;
- no temp residue after successful rename;
- attacker regular candidate unchanged on `EEXIST`;
- attacker symlink and target unchanged;
- `EEXIST` retry occurred; exhaustion bounded at five attempts;
- failed publication produced no successful ready result;
- atomic rename preserved; R6-H01 shutdown latch and R6-M03 identity functional.

Live production publication evidence is distinguished from deterministic external seam evidence
for collision/symlink/retry cases.

### L03 Linux evidence

- exact correlated positive case passed;
- foreign `runId` failed with `missing correlated event READY runId=run-a role=holder`;
- wrong order failed with exact expectation text;
- unrelated event failed;
- `assertNoCorrelatedEvent` sanity passed.

### L04 Linux evidence

- live Neo process `Umask=0077` (`pid` recorded in evidence);
- state and execution directories **0700** owner-only;
- `ready.json` **0600**; `neo.primary.lock` **0600**;
- SQLite DB, WAL, and SHM all **0600** when present;
- status exit **0**, `ready:true`, schema v2 identity valid;
- status caused no hash, mode, or durable inventory mutation;
- cooperative shutdown clean; readiness removed; no process residue.

## Final package disposition

`R6_LOW_HARDENING_PACKAGE_CLOSED_WITH_DESCRIPTOR_SAFE_CONFIG_EXCLUSIVE_READINESS_CORRELATED_EVIDENCE_AND_OWNER_ONLY_STATE`

Individual finding disposition:

- **R6-L01 — CLOSED**
- **R6-L02 — CLOSED**
- **R6-L03 — CLOSED**
- **R6-L04 — CLOSED**

## Codex Review №6 overall status

### Remediated findings now closed

- R6-H01
- R6-H02
- R6-M01
- R6-M02
- R6-M03
- R6-L01
- R6-L02
- R6-L03
- R6-L04

### Remaining deferred work (not auto-started)

- deferred systemd security hardening;
- online dependency/provenance review;
- previously recorded non-blocking INFO/LOW backlog (intermediate ancestor-symlink residual;
  readiness write `bytesWritten` hardening; direct umask unit-test improvement; child-stderr
  uncorrelated fallback; documentation duplication; encryption-at-rest deferred);
- Secret Provider and encryption-at-rest;
- production deployment and authoritative broad security validation.

Codex Review №6 as a whole remains **blocked** pending deferred systemd hardening, online
dependency/provenance review, and explicit security approval / deployment readiness gates.
`securityApprovalComplete` and `deploymentReady` remain false. Production/VPS/connectors remain
prohibited.

## Diagnostics

No diagnostics values changed for this closeout.

Still false:

- `deploymentReady`
- `securityApprovalComplete`
- `secretProviderConfigured`
- `encryptionEnabled`
- durable Approval port
- durable Audit port
- channel/connector readiness
