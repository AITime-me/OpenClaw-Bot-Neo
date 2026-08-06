# Build 3.7E1 — Probe-only Codex Subscription Route

Build 3.7E1 implements the package-private probe-only Codex app-server stdio adapter per
[Build 3.7E1A decisions](build-3.7e1a-codex-subscription-probe-decisions.md). Fake matrix covered
in CI. Live probe not run.

## Status

BEGIN_BUILD_3_7E1_MARKERS
BUILD_ID: 3.7E1
BUILD_KIND: PROBE_ONLY_IMPLEMENTATION
IMPLEMENTATION_STATUS: IMPLEMENTED
ROUTE_SCOPE: PROBE_ONLY
ADAPTER: CODEX_APP_SERVER_STDIO
AUTH_BOUNDARY: CODEX_MANAGED_CHATGPT_OAUTH
NEO_READS_CREDENTIALS: FALSE
CODEX_HOME: ISOLATED_REQUIRED
API_FALLBACK_ENABLED: FALSE
PAID_FALLBACK_ENABLED: FALSE
NEO_SQLITE_PERSISTENCE: FORBIDDEN
DURABLE_3_7D_INTEGRATION: BLOCKED_BY_ENCRYPTION
OPENCLAW_ROUTE: OUT_OF_SCOPE
LIVE_PROBE_STATUS: NOT_RUN
LIVE_PROBE: OWNER_APPROVAL_REQUIRED
PRODUCTION_READY: FALSE
SECURITY_APPROVED: FALSE
PACKAGE_ROOT_EXPORTS: ABSENT
NEXT_STAGE: OWNER_APPROVED_LIVE_PROBE_THEN_ENCRYPTION_GATE
END_BUILD_3_7E1_MARKERS

## Implemented

- Package-private `src/communication/adapters/codex-app-server/**` stdio client, protocol, pin,
  child env, config, LLM completion port, capability probe, route factory
- In-process fake app-server covering Decision 16 matrix
- Boundary / depcruise / flow verifier updates allowing only `codex-app-server`
- Manual owner probe script `scripts/manual/codex-app-server-owner-probe.mjs` (not in default check;
  requires exact `OWNER_PROBE_CONFIRMATION`)
- Focused protocol / env / pin / fake client / LLM / boundary tests

## Still absent / not run

- LIVE_PROBE_STATUS: NOT_RUN — no real Codex login, app-server spawn, or model call in this Build
- Durable 3.7D wiring (BLOCKED_BY_ENCRYPTION)
- OpenClaw route, Telegram, encryption, production composition
- Package-root exports and new npm dependencies

## Evidence notes

- Prompt/output are not written to Neo SQLite by this adapter
- Neo does not read credential files; `cli_auth_credentials_store="file"` under isolated CODEX_HOME
- Spawn contract: pinned absolutePath, `shell: false`, no PATH

## Next stage

Owner-approved single non-persistent live probe, then encryption gate before durable live wiring.
