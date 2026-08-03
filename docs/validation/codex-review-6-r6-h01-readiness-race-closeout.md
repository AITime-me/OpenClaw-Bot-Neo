# Codex Review №6 — R6-H01 readiness shutdown/publication race closeout

## Scope

This record closes **only** Codex Review №6 finding **R6-H01** for cooperative shutdown/readiness
publication ordering.

This record does **not** establish:

- overall Codex Review №6 pass;
- `securityApprovalComplete=true`;
- `deploymentReady=true`;
- production deployment;
- VPS deployment;
- authoritative security certification;
- resolution of all readiness or lifecycle risks.

Evidence paths were temporary local artifacts and are **not** repository artifacts. This record
stores hashes and result summaries only, not volatile absolute user paths.

## Finding

| Field | Value |
|-------|-------|
| ID | R6-H01 |
| Original severity | HIGH |
| Trust boundary | lifecycle → readiness/status |
| Affected area | `src/neo-runtime/cli/run-neo-process.ts` orchestration |
| Original reachable race | 1) readiness publication started asynchronously; 2) SIGTERM/SIGINT/fatal shutdown removed readiness; 3) in-flight publication completed afterwards; 4) `ready.json` was recreated; 5) `neo.runtime.ready` could be emitted; 6) a stopping/dead process could appear ready |

## Remediation

| Field | Value |
|-------|-------|
| Implementation commit | `6b89e7a2d3be072328828bb465b66a937a48349e` |
| Subject | `fix(neo-runtime): suppress readiness after shutdown latch during publication` |
| Parent | `2524bb04bebef1b3356f059e6a52c5520a84b322` |
| Package-lock SHA-256 | `f8b9ce9fdbf3dd1d69f219df2a997e58b1cd5abcb077312b5151ba729175db54` (unchanged) |

### Post-publication latch algorithm

1. Existing pre-publication shutdown check retained.
2. After successful `await deps.readiness.publish(...)`, synchronously recheck `lifetime.isRequested()`.
3. If shutdown was latched during publication:
   - readiness removed again (idempotent best-effort);
   - `neo.runtime.ready` suppressed;
   - no second shutdown initiated;
   - no direct duplicate `runtime.close()`;
   - existing `shutdownCloseInFlight` awaited;
   - existing exit disposition preserved.
4. No mutex, new exit code, or systemd change.
5. Normal ready path and publish-failure path unchanged.

## Combined closure evidence

R6-H01 closure is supported by all three required layers below.

### 1. Deterministic local regression

| Check | Result |
|-------|--------|
| Race suite | `tests/neo-runtime-readiness-shutdown-race.test.ts` — **20 passed** |
| Full suite | **1485 passed**, 3 skipped |
| Aggregate check | exit `0` |
| format/typecheck/lint/build/boundaries/secrets/hygiene/systemd-template | PASS |
| package-lock | unchanged |

Covered behavior includes: SIGTERM/SIGINT/fatal during pending publication; signal after simulated
readiness commit before publish promise resolution; no `neo.runtime.ready` when shutdown wins; final
readiness absent; runtime close exactly once; repeated signals do not duplicate shutdown; SIGHUP
preserves normal readiness; exit codes `0` / `11` / `12` / `13` preserved.

### 2. Independent source and test review

| Item | Value |
|------|-------|
| Verdict | `R6_H01_INDEPENDENT_REVIEW_APPROVED_WITH_NOTES_FOR_LINUX_REGRESSION` |
| BLOCKER / HIGH / MEDIUM / LOW in patch | none |
| Original race | confirmed reachable |
| Post-publish latch | same monotonic shutdown latch; `shutdownCloseInFlight` available by synchronous ordering |
| Signal interleaving | no callback can interleave between synchronous post-check and ready-event emit |
| Duplicate close | none |
| Fixture | deterministic; exercises real `runNeoProcess` |

INFO notes only:

- production readiness removal remains best-effort on unlink failure;
- diagnostics assertion in race suite was weak but diagnostics were outside the diff;
- deferred test window is intentionally wider than production;
- focused test-count wording differed while full results were verified independently.

### 3. Non-authoritative Linux L1–L5 regression

| Artifact | Value |
|----------|-------|
| Source commit | `6b89e7a2d3be072328828bb465b66a937a48349e` |
| Package-lock SHA-256 | `f8b9ce9fdbf3dd1d69f219df2a997e58b1cd5abcb077312b5151ba729175db54` |
| Git bundle SHA-256 | `add467465d7dea7d7c165110fc215781fcf9dd224a252da5251c97a8f6602304` |
| Offline dependency image | `sha256:cc961fff5f5defc144eab8a540500ae43b68cb58ffdbf2d42c3a2b0fd6fbc834` |

Image label limitation: the dependency image carries an older source commit label and is
dependency-only / **non-authoritative** for source identity. Exact current source came from the
verified Git bundle and was rebuilt inside the disposable container.

| Environment | Value |
|-------------|-------|
| Platform | disposable Ubuntu 24.04.4 container on WSL2 kernel |
| Architecture | linux/amd64 |
| Network | none |
| uid/gid | `10001:10001` |
| Node / npm | `v22.13.0` / `10.9.2` |
| Credentials / connectors | not used |

| Gate | Result |
|------|--------|
| Invocation | exactly once; no retry |
| Exit | `0` |
| Watchdog | false |
| PASS marker | `BUILD_3_4_LINUX_NEO_RUNTIME_GATE_PASSED` (exactly once) |
| Bootstrap | PASS |
| Environment gate | PASS |
| Scenarios | L1–L5 PASS; no SKIP |
| Evidence manifest | **31/31** verified; zero failures |

Required cooperative checks:

- L1 SIGTERM exit `0`; readiness `ready→absent`; expected lifecycle order;
- L5 SIGHUP preserved readiness; SIGINT exit `0`; readiness `ready→absent`;
- no cooperative stale `ready.json`;
- no zombies/orphans; process groups empty; execution roots removed.

Ordinary L1 and L5 were **regression checks** and did **not** probabilistically reproduce the
narrow original publication race. That race is covered by deterministic unit tests.

## Claim boundary

- Non-authoritative disposable Linux regression only.
- Not production or VPS validation.
- Not security approval.
- Not deployment approval.
- Cooperative SIGTERM/SIGINT/fatal shutdown publication ordering only.
- SIGKILL/PID-reuse stale readiness and temp-file hardening remain separate open findings.

## Final R6-H01 disposition

**R6-H01 is closed for cooperative shutdown/readiness-publication ordering based on deterministic
race tests, independent source review and disposable Linux L1–L5 regression.**

This does **not** mean all readiness security is complete.

## Diagnostics disposition

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

R6-H01 does **not** close:

1. **R6-H02** — raw secrets may reach durable memory through an injected allow-policy — **CLOSED**
   (see [R6-H02 closeout](codex-review-6-r6-h02-durable-memory-secret-boundary-closeout.md))
2. **R6-M01** — fatal close failure may lose retryable owner cleanup state — **CLOSED**
   (see [R6-M01 closeout](codex-review-6-r6-m01-retryable-durable-owner-closeout.md))
3. **R6-M02** — production Node gate is not connected to launcher (**next highest priority**)
4. **R6-M03** — status/readiness is not bound to live process identity
5. **R6-L01** — config lstat/open TOCTOU
6. **R6-L02** — readiness temp-file exclusive/no-follow hardening
7. **R6-L03** — integration event verification is too broad
8. **R6-L04** — group-readable unencrypted state
9. deferred systemd security hardening
10. online dependency/provenance review

Codex Review №6 as a whole remains **blocked** pending remediation of remaining findings,
starting with **R6-M02**.
