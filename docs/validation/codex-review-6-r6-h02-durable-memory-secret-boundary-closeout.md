# Codex Review №6 — R6-H02 durable-memory secret boundary closeout

## Scope

This record closes **only** Codex Review №6 finding **R6-H02** for the bounded
secret-class/provenance guarantee on durable memory writes.

This record does **not** establish:

- overall Codex Review №6 pass;
- `securityApprovalComplete=true`;
- `deploymentReady=true`;
- production deployment;
- VPS deployment;
- authoritative security certification;
- universal detection of secrets inside arbitrary untyped free text;
- Secret Provider configuration;
- encryption at rest;
- resolution of all memory or credential risks.

Evidence paths were temporary local artifacts and are **not** repository artifacts. This record
stores hashes and result summaries only, not volatile absolute user paths.

## Finding

| Field | Value |
|-------|-------|
| ID | R6-H02 |
| Original severity | HIGH |
| Trust boundary | untrusted or connector-derived content → sensitivity scanner → product memory policy → approval → verified write → MemoryPort → SQLite/in-memory persistence |
| Original capability | 1) Scanner denied recognized credential patterns. 2) Scanner-unknown content continued to product policy. 3) `createExplicitAllowMemoryPolicy()` could return allow. 4) Existing verified-write seal did not prove mandatory secret clearance. 5) Accepted content could reach SQLite or in-memory storage. 6) Exact Neo production bootstrap remained deny-by-default, but the capability existed in the app-private foundation. |
| Scanner vs provenance | Pattern scanner detects recognized credential shapes in ordinary text (defense-in-depth). Secret-class/provenance boundary rejects explicitly tainted or opaque secret-bearing values regardless of scanner result or product allow-policy. |

## Enforceable guarantee

**Secret-class and secret-provenance values are non-persistable through the guarded memory pipeline,
independent of scanner result, product policy or approval.**

## Unclaimed guarantee

Arbitrary untyped free text may contain an unknown secret format that no scanner can reliably
identify. This remediation does **not** claim universal free-text credential detection.

## Implementation

| Field | Value |
|-------|-------|
| Initial implementation commit | `e385d66af93b889f2b9424a4ed85d326c875c4e4` |
| Initial subject | `fix(security): enforce non-overrideable raw-secret boundary on durable memory writes` |
| Initial parent | `b6249ee36cbb14bcc1450546f63795c8502d6bab` |
| Corrective implementation commit | `21a637fd619fd1c1e3de496e508ce9a4b673b9ff` |
| Corrective subject | `fix(security): bind durable-memory clearance to a single verified write` |
| Corrective parent | `e385d66af93b889f2b9424a4ed85d326c875c4e4` |
| Package-lock SHA-256 | `f8b9ce9fdbf3dd1d69f219df2a997e58b1cd5abcb077312b5151ba729175db54` (unchanged) |

### Initial implementation (`e385d66`)

- Runtime-opaque WeakMap-sealed `SecretData`; `toString`/`valueOf` return `[opaque-secret]`.
- Minimal opaque `SecretReference` without secret material; persistence contract deferred.
- `SecretsPort.resolve()` returns `SecretData`, not plain string.
- Explicit `contentSensitivity: 'secret-class'` provenance on memory write commands.
- Mandatory `evaluateMemorySecretBoundary` before scanner and product policy; `SECRET_CLASS_DENIED`.
- Product allow-policy cannot revive secret denial; approval cannot override.
- Successful writes require internal `SecretBoundaryClearance` sealed into `VerifiedMemoryWrite`.
- SQLite and in-memory sinks reject missing clearance before transaction or mutation.
- No SQLite schema migration; no diagnostics flip; no encryption or provider configuration.

### Corrective remediation (`21a637f`)

- Clearance bound to exact `SecretBoundaryClearanceBinding` (sanitized content/metadata object
  identity plus all security-relevant scalar and structural fields).
- Clearance single-use: consumed atomically during `sealVerifiedMemoryWrite`; reuse fails.
- Different-write substitution fails; binding mismatch does not consume the token.
- Spread/serialization of clearance or verified write creates no authority.
- Sinks import only narrow read-only `verified-memory-write-guard.ts`; cannot import issuer,
  sealer or `SecretData` raw reader.
- Dependency-cruiser and boundary-checker tightened (`memory-sink-clearance-guard-only`).
- Native `better-sqlite3` regression: missing clearance → `VALIDATION_FAILED`, no mutating SQL,
  zero rows; cleared write succeeds separately.
- Unknown-format synthetic test directly asserts scanner `allow` before provenance denial.
- Stale architecture wording corrected.

## First independent review

| Item | Value |
|------|-------|
| Verdict | `R6_H02_INDEPENDENT_REVIEW_BLOCKED` |
| Confirmed | Main boundary (SecretData opacity, mandatory guard, product-policy non-override, sink guards, no-leak, ordinary-memory compatibility) |
| Blocking MEDIUM | R6H02-IR-M01 clearance not content-bound/reusable; R6H02-IR-M02 sink import authority too broad; R6H02-IR-M03 no native SQLite pre-transaction regression |
| LOW | R6H02-IR-L01 scanner-allow not directly asserted; R6H02-IR-L02 architecture wording stale |

## Final independent re-review

| Item | Value |
|------|-------|
| Verdict | `R6_H02_INDEPENDENT_REREVIEW_APPROVED_FOR_SECURITY_FINDING_CLOSEOUT` |
| M01–M03 | CLOSED |
| Prior LOW notes | CLOSED |
| New BLOCKER / HIGH / MEDIUM | none |
| INFO only | binding container not frozen at issue (production issue→seal synchronous; issuer trusted); guard depcruise relationship constrained by boundary-checker secret allowlist |

### Security proofs (P1–P18)

| Proof | Result |
|-------|--------|
| P1 runtime-opaque SecretData | PASS |
| P2 SecretsPort no-string contract | PASS |
| P3 secret provenance monotonicity for tagged/SecretData paths | PASS |
| P4 mandatory guard before product policy | PASS |
| P5 product allow-policy cannot override | PASS |
| P6 approval cannot override | PASS |
| P7 clearance cannot be structurally forged | PASS |
| P8 clearance cannot be reused or substituted | PASS |
| P9 sinks reject missing clearance | PASS |
| P10 SQLite rejection before transaction execution | PASS |
| P11 in-memory rejection before mutation | PASS |
| P12 direct production bypass prevented within enforced boundaries | PASS |
| P13 raw value absent from errors/log/audit | PASS |
| P14 scanner-unknown secret-provenance regression valid | PASS |
| P15 ordinary memory compatibility preserved | PASS |
| P16 no SQLite schema migration | PASS |
| P17 dependency/import boundaries not weakened | PASS |
| P18 diagnostics remain honest | PASS |

## Test and verification evidence

| Check | Result |
|-------|--------|
| Focused corrective re-review tests | **326 passed** |
| Full suite | **1519 passed**, 3 skipped |
| format:check | PASS |
| typecheck | PASS |
| lint | PASS |
| build | PASS |
| check:boundaries | PASS |
| check:secrets | PASS |
| check:hygiene | PASS |
| check:systemd-template | PASS |
| `OPENCLAW_PRODUCTION_NODE_GATE=1 npm run check` | PASS |
| package-lock | unchanged |
| schema/migrations | unchanged |

Key suites: `tests/memory-secret-boundary.test.ts` (binding, anti-reuse, SQLite verbose rejection,
scanner-allow + provenance denial), `tests/boundaries.test.ts` (forbidden sink→issuer/reader
fixtures), memory isolation and public API boundary checks.

## Linux disposition

**NO_LINUX_RERUN_REQUIRED**

Reason: guard remains a synchronous pre-transaction capability check; SQLite schema and normal SQL
write behavior unchanged; native `better-sqlite3` rejection and successful-write paths tested
locally; durable composition and Neo runtime/process orchestration unchanged; systemd unchanged.

## Claim boundary

### Closed within this finding

- explicit secret-class/provenance memory writes;
- scanner-unknown but explicitly secret-tainted values;
- product allow-policy override of secret denial;
- approval override of secret denial;
- missing/forged clearance at seal or sink;
- clearance reuse/substitution;
- unguarded SQLite/in-memory sink writes within production composition;
- sink authority over issuer/raw reader.

### Not closed

- universal detection of secrets inside arbitrary untyped free text;
- actual Secret Provider implementation;
- credential storage;
- encryption at rest;
- production connector authentication;
- all remaining Codex Review №6 findings;
- production/VPS readiness.

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

`secretBoundaryProductionReady` was **not** added.

## Open findings (Codex Review №6)

R6-H02 does **not** close:

1. **R6-M01** — fatal close failure may lose retryable owner cleanup state — **CLOSED**
   (see [R6-M01 closeout](codex-review-6-r6-m01-retryable-durable-owner-closeout.md))
2. **R6-M02** — production Node gate is not wired into launcher (**next highest priority**)
3. **R6-M03** — readiness/status is not bound to a live process identity
4. **R6-L01** — config lstat/open TOCTOU
5. **R6-L02** — readiness temp-file exclusive/no-follow hardening
6. **R6-L03** — integration event verification is too broad
7. **R6-L04** — group-readable unencrypted state
8. deferred systemd security hardening
9. online dependency/provenance review

Codex Review №6 as a whole remains **blocked** pending remediation of remaining findings,
starting with **R6-M02**.

## Final R6-H02 disposition

**R6_H02_SECURITY_FINDING_CLOSED_WITH_NON_OVERRIDEABLE_SECRET_PROVENANCE_BOUNDARY**

This does **not** mean all memory or credential security is complete.

SECURITY_APPROVAL_COMPLETE=false

SECRET_PROVIDER_CONFIGURED=false

ENCRYPTION_ENABLED=false
