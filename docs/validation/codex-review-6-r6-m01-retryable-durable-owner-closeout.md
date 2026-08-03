# Codex Review №6 — R6-M01 retryable durable owner closeout

## Scope

This record closes **only** Codex Review №6 finding **R6-M01** for fatal close failure that
could destroy the only retryable durable owner reference.

This record does **not** establish:

- overall Codex Review №6 pass;
- `securityApprovalComplete=true`;
- `deploymentReady=true`;
- production deployment;
- VPS deployment;
- authoritative security certification;
- Secret Provider configuration;
- encryption at rest;
- durable Approval/Audit readiness;
- channel/connector readiness;
- resolution of R6-M02, R6-M03, R6-L01–R6-L04, systemd hardening, or online dependency review.

Evidence paths were temporary local artifacts and are **not** repository artifacts. This record
stores result summaries only, not volatile absolute user paths.

## Finding

| Field | Value |
|-------|-------|
| ID | R6-M01 |
| Original severity | MEDIUM |
| Trust boundary | Neo runtime lifecycle state → durable owner responsibility → shutdown retry coordinator → shutdown events and exit disposition |
| Original failure path | 1) runtime owned durable owner O1; 2) fatal shutdown called `runtime.close('fatal')`; 3) O1.close() returned incomplete; 4) runtime called `markFailed('RUNTIME_FATAL')`; 5) previous `markFailed()` cleared owner and set `durableHostOpened=false`; 6) outer `closeRuntimeWithRetry` retried runtime.close(); 7) previous failed-state branch returned immediate success; 8) O1 was never retried; 9) process could emit `neo.runtime.stopped`; 10) SQLite/process-lock/storage-root cleanup could remain incomplete |

## Durable owner contract

Disposition recorded at closeout:

- owner close is retryable;
- incomplete close retains stage cursor and ownership;
- the same owner object must be retried;
- completed close is idempotent;
- the runtime/process coordinator owns retry scheduling (`closeRuntimeWithRetry`);
- no durable-owner implementation contract change was required for this remediation.

## Remediation

| Field | Value |
|-------|-------|
| Implementation commit | `c73aaecd7e8e00e4f0a2ecfc64141063cabaeaf3` |
| Subject | `fix(neo-runtime): preserve durable owner across fatal close retries` |
| Parent | `586940857a6cc5c9fd1225236b3ac21b5d4635c8` |
| Package-lock SHA-256 | `f8b9ce9fdbf3dd1d69f219df2a997e58b1cd5abcb077312b5151ba729175db54` (unchanged) |

### Strategy A

- lifecycle may remain terminally `failed`;
- unresolved durable owner remains privately retained;
- normal operations and restart remain prohibited;
- cleanup remains callable while failed;
- every retry targets the same owner object;
- owner is cleared only after confirmed cleanup success;
- `durableHostOpened=true` remains while owner cleanup is unresolved;
- successful later cleanup preserves lifecycle `failed`;
- `failureClass=RUNTIME_FATAL` remains visible;
- failed cleanup returns incomplete rather than false success;
- existing `closeInFlight` serializes owner close attempts;
- incomplete attempt clears only the in-flight promise and permits later retry;
- successful cleanup makes repeated close a safe no-op;
- no second owner may open while cleanup responsibility remains.

No changes were made to durable owner implementation, SQLite, process lock, readiness/status,
systemd, public lifecycle state union, public close result union, exit-code table, package-lock,
or diagnostics.

## Ownership proofs (O1–O15)

| Proof | Result |
|-------|--------|
| O1 failed cleanup retains exact owner | PASS |
| O2 failed lifecycle remains terminal for normal operations | PASS |
| O3 cleanup remains callable while failed | PASS |
| O4 owner clears only after confirmed success | PASS |
| O5 incomplete cleanup never returns false success | PASS |
| O6 at most one owner.close attempt is in flight | PASS |
| O7 every retry uses the same owner | PASS |
| O8 no second owner opens while cleanup is pending | PASS |
| O9 fatal lifecycle and failureClass remain after later cleanup success | PASS |
| O10 exit semantics remain honest | PASS |
| O11 no stopped event is emitted for incomplete cleanup | PASS |
| O12 repeated close after cleanup is a safe no-op | PASS |
| O13 startup rollback retains retryable owner where applicable | PASS |
| O14 graceful shutdown compatibility is preserved | PASS |
| O15 diagnostics and unrelated components remain unchanged | PASS |

## Runtime/process behavior

### Fatal first failure, second success

- first result incomplete;
- lifecycle becomes failed;
- failureClass remains `RUNTIME_FATAL`;
- exact owner retained;
- second attempt targets same owner;
- second attempt succeeds;
- owner cleared only after success;
- `durableHostOpened` becomes false only after success;
- restart remains prohibited;
- `neo.runtime.stopped` occurs only after successful cleanup;
- process exit remains **12**.

### Fatal retry exhaustion

- three configured attempts remain incomplete;
- all target same owner;
- no false success;
- `neo.runtime.shutdown_timeout` emitted;
- `neo.runtime.stopped` absent;
- fatal exit remains **12** due to existing precedence over shutdown timeout.

### Graceful behavior

- graceful incomplete close retains owner;
- retry can succeed;
- successful graceful cleanup reaches stopped;
- graceful retry exhaustion remains exit **13**;
- no fatal classification introduced.

### Startup compatibility

- close-before-start preserved;
- close-during-start latch preserved;
- owner created after latch is closed;
- incomplete rollback retains owner;
- retry targets same owner;
- no second owner opens.

### Concurrency

- concurrent close callers share one in-flight promise;
- only one owner.close attempt runs at a time;
- failed attempt allows later retry;
- success prevents later owner access.

## Independent review

| Item | Value |
|------|-------|
| Verdict | `APPROVE_WITH_NOTES_R6_M01_FOR_SECURITY_FINDING_CLOSEOUT` |
| Final status | `R6_M01_INDEPENDENT_REVIEW_APPROVED_WITH_NOTES_FOR_SECURITY_FINDING_CLOSEOUT` |
| Parent defect | confirmed real; MEDIUM justified |
| Durable owner retry-safety | confirmed |
| Strategy A | correctly implemented |
| BLOCKER / HIGH / MEDIUM / LOW | none |
| O1–O15 | all PASS |
| Linux | `NO_LINUX_RERUN_REQUIRED` |
| Reviewer mutation | repository unchanged by reviewer |

## INFO notes (non-blocking test-quality backlog)

### INFO-01

Process-coordinator event assertions use `.some()` rather than strict total ordering.

Disposition:

- event emission is still gated by final close result;
- no false stopped behavior was found;
- does not block closure;
- may be tightened later as test-quality backlog.

Do **not** convert into a new R6 finding.

### INFO-02

Concurrent fatal test uses a synchronous owner.close double rather than a deferred microtask
barrier.

Disposition:

- existing `closeInFlight` behavior and other concurrency tests prove serialization;
- no duplicate native close found;
- does not block closure;
- may be strengthened later as test-quality backlog.

Do **not** convert into a new R6 finding.

## Test and verification evidence

| Check | Result |
|-------|--------|
| Focused implementation report | **49** focused tests reported (broader focused selection) |
| Independent reviewer focused reproduction | **46** tests across the two primary focused files (`tests/neo-runtime-production-composition.test.ts`, `tests/neo-runtime-process-coordinator.test.ts`) |
| Full suite | **1537 passed**, 3 skipped |
| format:check | PASS |
| typecheck | PASS |
| lint | PASS |
| build | PASS |
| check:boundaries | PASS |
| check:secrets | PASS |
| check:hygiene | PASS |
| check:systemd-template | PASS |
| git diff --check | PASS |
| production Node check | PASS |
| `OPENCLAW_PRODUCTION_NODE_GATE=1 npm run check` | PASS during independent review |
| package-lock | unchanged |
| schema/migrations | unchanged |

The reviewer-verified **46** count and the implementation-reported **49** count are **not** the
same measured subset: 46 covers the two primary focused files; 49 is the broader focused
selection reported by the implementation.

## Linux disposition

**NO_LINUX_RERUN_REQUIRED**

Reason:

- durable owner implementation unchanged;
- SQLite/process-lock cleanup unchanged;
- process signal orchestration not materially redesigned;
- patch is pure TypeScript lifecycle ownership logic;
- deterministic fake-owner and real retry-coordinator tests cover behavior;
- systemd unchanged.

## Claim boundary

### Closed within this finding

- owner loss after fatal incomplete close;
- false successful retry after owner loss;
- same-owner retry responsibility;
- owner-clear-only-on-success rule;
- cleanup while lifecycle remains failed;
- no restart after fatal failure;
- false stopped event caused by false close success;
- fatal first-fail/second-success;
- fatal retry exhaustion honesty;
- graceful compatibility;
- startup rollback same-owner retry;
- concurrent close serialization.

### Not closed

- R6-M02 — production Node gate is not wired into launcher;
- R6-M03 — readiness/status is not bound to live process identity;
- R6-L01 — config lstat/open TOCTOU;
- R6-L02 — readiness temp-file exclusive/no-follow hardening;
- R6-L03 — integration event verification is too broad;
- R6-L04 — group-readable unencrypted state;
- deferred systemd hardening;
- online dependency/provenance review;
- production/VPS readiness;
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

R6-M01 does **not** close:

1. **R6-M02** — production Node gate is not wired into launcher (**next highest priority**)
2. **R6-M03** — readiness/status is not bound to live process identity
3. **R6-L01** — config lstat/open TOCTOU
4. **R6-L02** — readiness temp-file exclusive/no-follow hardening
5. **R6-L03** — integration event verification is too broad
6. **R6-L04** — group-readable unencrypted state
7. deferred systemd security hardening
8. online dependency/provenance review

Codex Review №6 as a whole remains **blocked** pending remediation of remaining findings,
starting with **R6-M02**.

## Final R6-M01 disposition

**R6_M01_SECURITY_FINDING_CLOSED_WITH_RETRYABLE_DURABLE_OWNER_PRESERVATION**

This does **not** mean overall Codex Review №6 is complete.

SECURITY_APPROVAL_COMPLETE=false

DEPLOYMENT_READY=false
