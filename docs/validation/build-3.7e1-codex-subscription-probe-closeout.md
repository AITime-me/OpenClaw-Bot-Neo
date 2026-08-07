# Build 3.7E1 — Probe-only Codex Subscription Route

Build 3.7E1 implements the package-private probe-only Codex app-server stdio adapter per
[Build 3.7E1A decisions](build-3.7e1a-codex-subscription-probe-decisions.md). Fake matrix covered
in CI. First live preflight against codex-cli **0.147.0** executed and failed closed before
`thread/turn` (compatibility), recorded below — **not** PASS.

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
LIVE_PROBE_STATUS: EXECUTED_FAIL
LIVE_PROBE_OUTCOME: provider-unavailable
LIVE_PROBE_FAILURE_STAGE: PRE_DISPATCH_COMPATIBILITY
LIVE_PROBE_CODEX_CLI: 0.147.0
LIVE_PROBE: OWNER_APPROVAL_REQUIRED
PRODUCTION_READY: FALSE
SECURITY_APPROVED: FALSE
PACKAGE_ROOT_EXPORTS: ABSENT
NEXT_STAGE: CODEX_0147_COMPAT_THEN_OWNER_APPROVED_LIVE_RETRY
END_BUILD_3_7E1_MARKERS

## Implemented

- Package-private `src/communication/adapters/codex-app-server/**` stdio client, protocol, pin,
  child env, config, LLM completion port, capability probe, route factory
- Codex **0.147.0** compatibility corrective: `initialize.capabilities.optOutNotificationMethods`
  for `remoteControl/status/changed`; security-critical `config/read` checks using 0.147.0 field
  names (`sandbox_mode`, `web_search`, `allow_login_shell`, …) without a total key allowlist;
  null is not treated as safe for approval/sandbox/web_search/login shell
- In-process fake app-server covering Decision 16 matrix + 0.147.0 observed/remoteControl fixtures
- Boundary / depcruise / flow verifier updates allowing only `codex-app-server`
- Manual owner probe script `scripts/manual/codex-app-server-owner-probe.mjs` (not in default check;
  requires exact `OWNER_PROBE_CONFIRMATION`)
- Focused protocol / env / pin / fake client / LLM / boundary tests

## First live attempt (EXECUTED_FAIL)

Owner preflight against real `codex-cli 0.147.0` **without** `thread/turn` model call observed:

- after `initialize`, server emitted `remoteControl/status/changed` (unknown to prior Neo allowlist);
- `config/read` returned an expanded runtime-effective object (many keys beyond the old allowlist);
- auth=chatgpt, plan=plus, provider=openai; `rateLimits/read` OK; `model/list` OK with sole default
  `gpt-5.6-sol`;
- effective values included `approval_policy=null`, `sandbox_mode=null`, `web_search=null`,
  `allow_login_shell=true`, empty MCP/apps/hooks/tools, and features such as `auth_elicitation`,
  `remote_plugin`, `tool_suggest`.

Outcome classification for that attempt: **`provider-unavailable`** at
**pre-dispatch compatibility** (not a successful live probe; not PASS). Corrective branch
`build-3-7e1-codex-0147-compat` addresses opt-out + critical-value preflight; a later
owner-approved live retry still requires an isolated `CODEX_HOME` config that sets the required
non-null safe values (see prerequisites below). Durable 3.7D wiring remains blocked.

## Isolated config prerequisites (codex-cli 0.147.0 names)

Under the probe-only isolated `CODEX_HOME` `config.toml` (owner-managed; Neo does not write
credentials):

- `cli_auth_credentials_store = "file"`
- `forced_login_method = "chatgpt"`
- `model_provider = "openai"`
- `approval_policy = "never"` — **null is rejected**
- `sandbox_mode = "read-only"` — **null is rejected**
- `web_search = "disabled"` — **null is rejected**
- `allow_login_shell = false` — **true/null rejected**
- MCP / apps / hooks empty or fully disabled; `tools.web_search` null/absent
- Disable agentic features: `features.remote_plugin`, `features.tool_suggest`,
  `features.auth_elicitation` must not be `true`
- No custom base URL / API-key provider overrides

Wire notes: `thread/start` uses `sandbox: "read-only"` and `runtimeWorkspaceRoots: [probeCwd]`;
`turn/start` uses official `{ type: "readOnly", networkAccess: false }` sandboxPolicy.

## Still absent / blocked

- Live probe PASS (model call) — not claimed
- Durable 3.7D wiring (BLOCKED_BY_ENCRYPTION)
- OpenClaw route, Telegram, encryption, production composition
- Package-root exports and new npm dependencies

## Evidence notes

- Prompt/output are not written to Neo SQLite by this adapter
- Neo does not read credential files; `cli_auth_credentials_store="file"` under isolated CODEX_HOME
- Spawn contract: pinned absolutePath + version + sha256 + sizeBytes, `shell: false`, no PATH,
  isolated HOME/USERPROFILE/temp/cwd, owner one-shot capability required for live spawn
- Official nested wire decoders: `result.account.type`, `result.config`, `result.requirements`,
  nested `rateLimits`/`rateLimitReachedType`, `model/list` `data[]` with `isDefault` +
  `inputModalities` including `text`

## Next stage

Apply isolated 0.147.0 config prerequisites, then a separate owner-approved non-persistent live
retry. Encryption gate remains before durable live wiring.
