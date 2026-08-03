# Build 3.4 — Neo disposable Linux runtime and systemd validation

## Scope

Build 3.4 records the Neo runtime/process/systemd foundation validated in **disposable Linux
environments only**.

This record does **not** establish:

- production deployment;
- VPS deployment;
- production boot validation;
- real channels or connectors;
- production credentials;
- security approval;
- assistant operational readiness.

## Exact identities

| Artifact | Value |
|----------|-------|
| Source commit | `4096a87586475aacb01dc27596c1e1dd494f9778` |
| Package-lock SHA-256 | `f8b9ce9fdbf3dd1d69f219df2a997e58b1cd5abcb077312b5151ba729175db54` |
| Source bundle SHA-256 | `c067aa98c9f4e1fa927ec2dbab9a461d43ccda94c332b67eb734f198cb28a69b` |
| Offline dependency image | `sha256:cc961fff5f5defc144eab8a540500ae43b68cb58ffdbf2d42c3a2b0fd6fbc834` |

The dependency image carries an **older, non-authoritative** source label. Authoritative source
identity is the verified Git bundle above, rebuilt inside each disposable Linux environment.

## Build 3.4E-STAB10 — Neo runtime L1–L5

| Check | Result |
|-------|--------|
| Environment | Disposable Linux container on WSL2 kernel |
| Gate exit | `0` |
| PASS marker | `BUILD_3_4_LINUX_NEO_RUNTIME_GATE_PASSED` (exactly once) |
| Scenarios | L1–L5 PASS; no SKIP |
| Evidence manifest | 36/36 verified |

### Supported runtime claims

- readiness absent → ready → removed;
- process remains alive after ready;
- no unfinished top-level-await warning;
- SIGTERM graceful shutdown exit `0`;
- second instance blocked with exit `10`;
- process lock reacquired after SIGKILL;
- durable composition reopened;
- malformed config exit `2`;
- SIGHUP ignored safely;
- SIGINT graceful shutdown exit `0`;
- no zombie/orphan/process-group residue.

### Bounded L3 claim only

- process-lock reacquisition;
- durable composition reopen.

**Not claimed:** deterministic memory-content persistence.

## Build 3.4F — systemd S1–S7

| Check | Result |
|-------|--------|
| Environment | Disposable Ubuntu 24.04.4 WSL2 |
| systemd | `255.4` as PID 1 |
| cgroup | v2 functional |
| Wrapper exit | `0` |
| PASS marker | `BUILD_3_4F_NEO_SYSTEMD_LINUX_VALIDATION_PASSED` (exactly once) |
| Scenarios | S1–S7 PASS; no SKIP |
| Template vs installed unit | byte-identical hashes |
| Installed `.service` | `systemd-analyze verify` exit `0` |
| Guest cleanup | service/user/unit/config/state/runtime paths removed |
| Production/VPS | not used |
| Connectors/credentials | not used |

### Evidence hygiene note

The Build 3.4F manifest reported **64/65** after independent review. Only `wrapper-stdout.txt`
changed because cleanup output was appended after manifest generation. Material scenario, unit,
journal, hardening, and cleanup evidence verified independently. This does **not** invalidate
systemd claims. Do **not** record “manifest 65/65”.

Host-side WSL distribution unregister is **not** independently evidenced in the stable record.

## Diagnostics disposition

### Now true (Build 3.4 closeout)

| Flag | Meaning |
|------|---------|
| `processLockWiredToNeo` | Production Neo composition uses the process lock during startup (L2, S6). |
| `neoSecondInstanceProtectionActive` | Another Neo on the same durable root is rejected with exit `10` (L2, S6). |
| `systemdLayerConfigured` | Committed systemd layer passed disposable S1–S7; not production-installed. |

### Still false

- `deploymentReady`
- `securityApprovalComplete`
- `secretProviderConfigured`
- `encryptionEnabled`
- durable Approval port
- durable Audit port
- channel/connector readiness (Telegram, GitHub, amoCRM, Timeweb, email, and others)

Primitive-only and owner-only diagnostics that explicitly do not represent Neo wiring remain
unchanged.

## Evidence boundaries

- Evidence paths were temporary local artifacts and are **not** repository artifacts.
- This record stores hashes and result summaries only, not volatile absolute user paths.
- WSL2/systemd disposable validation does not prove VPS-specific boot, network, or storage behavior.
- No production secrets or real integrations were used.

## Independent review

| Item | Value |
|------|-------|
| Verdict | `BUILD_3_4G_INDEPENDENT_REVIEW_APPROVED_WITH_NOTES_FOR_CLOSEOUT` |
| BLOCKER / HIGH / material MEDIUM | none |
| LOW / INFO | remain post-Build-3.4 backlog |

## Codex Review №6 R6-M02 forward reference (exit **3** non-restart)

Historical Build 3.4F disposable evidence validated `RestartPreventExitStatus=10` and cooperative
exit **10** second-instance behavior. It did **not** independently evidence launcher exit **3**
non-restart semantics.

Focused disposable systemd regression for Codex Review №6 **R6-M02** (post-Build-3.4) is the live
evidence for unsupported-runtime exit **3** propagation and `RestartPreventExitStatus=10 3`
non-restart behavior. See
[R6-M02 closeout record](codex-review-6-r6-m02-production-node-gate-systemd-closeout.md).
Historical Build 3.4F claims are **not** rewritten.

## Known non-blocking notes (post-Build-3.4 backlog)

1. L2/L3 harness should assert actual child exit codes instead of hardcoded exit-zero recording.
2. L5 should fail directly when `neo.signal.sighup_ignored` is absent.
3. L4 should retain direct child `neo.config.invalid` observability evidence.
4. Evidence wrapper output should be finalized before manifest generation.
5. Direct `systemd-analyze verify` requires a `.service` filename; committed `.template` is validated
   by content/static validator and by byte-identical installed `.service`.
6. Deferred systemd hardening directives remain later security work.
