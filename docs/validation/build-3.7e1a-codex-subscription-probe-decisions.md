# Build 3.7E1A — Codex Subscription Probe Decisions

Build 3.7E1A records the **architecture-only** decision package for a probe-only Codex
app-server subscription route. It freezes auth, isolation, allowlist, persistence, and the
exact implementation contract required before any adapter implementation package. No live probe,
no durable 3.7D wiring, no OpenClaw route confirmation, no production composition.

## Status

BEGIN_BUILD_3_7E1A_MARKERS
BUILD_ID: 3.7E1A
BUILD_KIND: ARCHITECTURE_ONLY
ROUTE_SCOPE: PROBE_ONLY
ADAPTER: CODEX_APP_SERVER_STDIO
AUTH_BOUNDARY: CODEX_MANAGED_CHATGPT_OAUTH
NEO_READS_CREDENTIALS: FALSE
CODEX_HOME: ISOLATED_REQUIRED
API_FALLBACK_ENABLED: FALSE
PAID_FALLBACK_ENABLED: FALSE
LIVE_PROBE: OWNER_APPROVAL_REQUIRED
NEO_SQLITE_PERSISTENCE: FORBIDDEN
DURABLE_3_7D_INTEGRATION: BLOCKED_BY_ENCRYPTION
OPENCLAW_ROUTE: OUT_OF_SCOPE
PRODUCTION_READY: FALSE
IMPLEMENTATION_READY: TRUE
END_BUILD_3_7E1A_MARKERS

`IMPLEMENTATION_READY: TRUE` is justified only because Decisions 1–19 freeze a complete,
fail-closed probe contract (env, pin, RPC, events, invocation boundary, outcomes, evidence limits,
fake matrix, live procedure, schema/deps/exports, and future file map). Architecture-only status
does **not** imply live probe run, production readiness, or OpenClaw verification.

## Decision 1 — Probe-only Codex app-server stdio route

The only subscription probe route authorized by this package is a **Codex app-server** adapter
speaking over **stdio** (newline-delimited JSON-RPC; `"jsonrpc":"2.0"` header omitted on the wire
per Codex app-server docs).

- Scope is **probe-only**: one owner-approved, non-persistent capability probe.
- The route is not production composition and does not open continuous daemon LLM traffic.
- WebSocket / Unix-socket app-server listeners are **forbidden** for the Neo probe route.
- Implementation may proceed only as a later implementation package that preserves these
  boundaries.

## Decision 2 — Codex-managed ChatGPT OAuth; Neo never reads credentials

Authentication remains **Codex-managed ChatGPT OAuth**.

- Neo must not read, parse, copy, log, or persist Codex/ChatGPT credential material.
- Neo must not invent a parallel OAuth client for this probe route.
- Neo must not call `account/login/*` RPCs during the automated probe path; pre-provisioned
  ChatGPT auth under the isolated `CODEX_HOME` is a manual owner prerequisite.
- Credential files under the isolated Codex home stay outside Neo SQLite and Neo audit sinks.

## Decision 3 — Isolated CODEX_HOME and pinned executable

Probe execution requires an **isolated `CODEX_HOME`**.

- Shared or developer-default Codex homes are forbidden for the Neo probe.
- The Codex executable must be **pinned** (Decision 10).
- Unpinned PATH resolution is forbidden for the probe route.

## Decision 4 — Strict env / config / event allowlists

The probe process may receive only an explicit allowlist of environment variables, config
keys, and event kinds (Decisions 9, 11–12).

- Unknown env, config, or event material is fail-closed.
- API-key auth modes, `OPENAI_API_KEY`, `CODEX_API_KEY`, and silent provider switching remain
  forbidden.
- Repository flags stay `apiFallbackEnabled=false` and `paidFallbackEnabled=false`.

## Decision 5 — Non-persistent probe; Neo SQLite persistence forbidden

Exactly **one** owner-approved non-persistent probe is in scope after implementation.

- Prompt and model output must **not** be stored in Neo SQLite (`neo-communication.sqlite` or
  any other Neo durable store).
- Probe evidence may be ephemeral process output / owner-visible console only, subject to
  sensitive-data scanning rules of later implementation Builds.
- Live probe execution remains **owner-approval required** and is **not run** by this
  architecture package.

## Decision 6 — Durable 3.7D integration blocked by encryption

Wiring this route into the durable Build 3.7D communication runtime remains
**BLOCKED_BY_ENCRYPTION**.

- Offline 3.7D fake LLM/delivery stays unchanged.
- Live conversational persistence through Telegram/model routes that store conversational
  content remains blocked while encryption is not implemented / not enabled.

## Decision 7 — OpenClaw is a separate, out-of-scope route

**Codex app-server** and **OpenClaw** are different routes.

- OpenClaw runtime compatibility remains **UNVERIFIED**.
- OpenClaw adapter paths are **OUT_OF_SCOPE** for Build 3.7E1A.
- Do not treat Codex and OpenClaw as one combined route or shared adapter tree.

## Decision 8 — API and paid fallback remain disabled

- API Platform / token-billed fallback: disabled.
- Paid fallback controlled by Neo: disabled.
- Upstream ChatGPT credit accounting after included quota is unchanged from Build 3.7E0
  research posture and is not controlled by Neo repository flags.

## Decision 9 — Child process environment allowlist and denylist

Child spawn uses an **explicit env object** (do not inherit the parent environment wholesale).

### Allowlist (exact keys; values constrained)

| Key | Constraint |
|-----|------------|
| `CODEX_HOME` | Absolute path to the isolated probe home; required; must not equal developer default `~/.codex`. |
| `HOME` | Absolute path; may equal `CODEX_HOME` or a dedicated empty probe home; never a shared interactive home. |
| `PATH` | Optional; only if the pinned executable is invoked by basename — preferred posture is absolute executable path with `PATH` omitted. |
| `LANG` | Optional locale; if set, must be a non-empty ASCII locale string. |
| `LC_ALL` | Optional; same constraint as `LANG`. |
| `TZ` | Optional timezone name; if set, non-empty. |
| `NO_COLOR` | Optional; if set, must be `"1"`. |
| `TERM` | Optional; if set, must be `"dumb"`. |

No other keys are permitted.

### Denylist (always stripped / fail-closed if present in proposed env)

`OPENAI_API_KEY`, `CODEX_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_API_BASE`, `OPENAI_ORG_ID`,
`OPENAI_PROJECT_ID`, `CHATGPT_ACCESS_TOKEN`, `CHATGPT_ACCOUNT_ID`, `CODEX_AUTH_JSON`,
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN`,
`NPM_TOKEN`, `NODE_OPTIONS`, `NODE_PATH`, `PYTHONPATH`, `LD_PRELOAD`, `DYLD_INSERT_LIBRARIES`,
`SSLKEYLOGFILE`, `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `http_proxy`, `https_proxy`,
`all_proxy`.

Any denylist key in the constructed child env is a hard configuration error before spawn.

### Config allowlist (Codex home / CLI config surface Neo may set)

Neo may place only these non-credential config decisions for the probe (names normative for E1):

- forced login / auth mode = ChatGPT OAuth (`chatgpt`); API-key auth mode forbidden;
- approval policy default = `never` for the probe thread;
- sandbox default = `readOnly` for the probe thread;
- model id = owner-pinned probe model string from config (no silent model switching);
- MCP servers = empty / disabled for the probe;
- experimental API capabilities = off unless a later decision package enables a named subset.

Neo must not write tokens, refresh material, or `auth.json` contents.

## Decision 10 — Executable pin tuple and checks

Pin tuple (all required before spawn):

1. `absolutePath` — absolute filesystem path to the Codex executable;
2. `version` — exact version string obtained from a pre-spawn `--version` (or equivalent) check
   against the same absolute path;
3. `sha256` — hex SHA-256 of the executable file bytes at `absolutePath`;
4. `argv` — exact argv vector beginning with `app-server` and including only allowlisted flags
   (`--listen stdio://` or the documented stdio default with **no** `ws://` / `unix://` listen).

Mandatory checks:

- reject relative paths and PATH-only resolution when pin mode is absolute;
- reject version mismatch vs configured expected version;
- reject hash mismatch vs configured expected hash;
- reject argv containing network listen endpoints, remote flags, or shell metacharacters;
- re-hash immediately before spawn; mismatch aborts without spawn.

## Decision 11 — Exact app-server RPC sequence

Normative probe sequence (client → server unless noted):

1. Spawn pinned Codex with stdio pipes only (stdin/stdout JSONL; stderr not treated as protocol).
2. Request `initialize` once with Neo clientInfo (`name`, `title`, `version`) and capabilities that
   **opt out** of high-churn deltas when available (`item/agentMessage/delta` may be opted out;
   final `item/completed` / `turn/completed` remain required).
3. Notification `initialized`.
4. Request `thread/start` with:
   - `ephemeral: true` (non-persistent Codex thread);
   - `approvalPolicy: "never"`;
   - `sandbox: "readOnly"`;
   - pinned `model`;
   - no `dynamicTools`, no MCP requirements, no `thread/resume` / `thread/fork`.
5. On successful thread id: request `turn/start` with tools-free text input only
   (`input: [{ type: "text", text: <probe prompt> }]`).
6. Read notifications until terminal `turn/completed` **or** a fail-closed mapping event
   (Decision 12–13).
7. Tear down: close stdin, wait for child exit with timeout, force-kill on hang; do not call
   `thread/resume` afterward.

Forbidden client RPCs for the probe path include: `account/login/*`, `thread/resume`,
`thread/fork`, `thread/shellCommand`, `turn/steer`, `mcpServer/*`, any experimental tool-injection
method, and any listen/transport reconfiguration RPC.

## Decision 12 — Event allowlist and forbidden events

### Allowlisted notifications / responses (consume)

- `initialize` result;
- `thread/start` result;
- `thread/started`;
- `turn/start` result;
- `turn/started`;
- `turn/completed`;
- `item/started` / `item/completed` for **agentMessage** / **userMessage** text items only;
- `item/agentMessage/delta` only if not opted out (may be ignored for assembly if final item text
  is present);
- JSON-RPC error responses for the requests Neo sent.

### Forbidden events (fail-closed)

Any of the following observed after provider invocation start maps per Decision 13:

- server requests requiring client approval (`item/commandExecution/requestApproval`,
  `item/fileChange/requestApproval`, `item/permissions/requestApproval`, or successors);
- command execution / file change / patch / MCP tool / shell items;
- `account/*` auth challenge events requiring Neo to handle credentials;
- unknown method names not on the allowlist.

Unknown frames that parse as JSON-RPC but carry non-allowlisted methods are forbidden.

## Decision 13 — Provider invocation start boundary

**Provider invocation start** is the instant Neo writes the `turn/start` request that includes the
probe prompt to the child stdin **after** successful pin checks, env construction, spawn,
`initialize`/`initialized`, and successful `thread/start`.

Before that boundary:

- abort / owner cancel → `cancelled-before-invocation`;
- pin/env/spawn/initialize/`thread/start` failure without sending `turn/start` →
  `provider-unavailable` (or `policy-rejected` for explicit local policy denial).

After that boundary, cancel/timeout/crash uncertainty follows Decision 14 (no silent retry).

Neo must transition to ledger `llm_started` only at or after this boundary, never earlier.

## Decision 14 — Timeout / abort / crash / malformed-frame outcome mapping

Map to existing `LlmCompletionOutcome` values only:

| Condition | Outcome |
|-----------|---------|
| Abort before provider invocation start | `cancelled-before-invocation` |
| Clean deadline expiry before invocation start | `known-timeout` |
| Abort or deadline after invocation start without a proven terminal `turn/completed` success or known failure classification | `outcome-unknown` |
| Child non-zero exit / signal kill after invocation start | `outcome-unknown` |
| Malformed stdout frame / non-JSON line on protocol stream after invocation start | `outcome-unknown` |
| Allowlisted turn completed with usable agent text | `completed` |
| Explicit provider/auth unavailable signaled before/at start without uncertain mid-turn state | `provider-unavailable` |
| Explicit quota / rate-limit exhaustion known classification | `quota-unavailable` |
| Forbidden tool/approval/command event after start | `policy-rejected` |
| Allowlisted completion with structurally invalid / empty required text | `invalid-response` |

No automatic retry. No API/paid fallback. No notice for `outcome-unknown`, `policy-rejected`, or
`invalid-response` beyond existing communication policy rules.

## Decision 15 — API / fallback evidence and proof limits

### What this architecture proves

- Neo repository flags keep `apiFallbackEnabled=false` and `paidFallbackEnabled=false`;
- Neo probe client must not send API-key auth RPCs or set denylisted API key env vars;
- Neo must not call Platform API HTTP endpoints as part of this route.

### What this architecture does **not** prove

- that an already-funded ChatGPT credit balance cannot be consumed upstream after included quota
  (Build 3.7E0);
- that a compromised or mis-pinned Codex binary cannot perform other network behavior;
- that OpenClaw runtime auth is safe or verified;
- that production composition is ready.

Live probe evidence (later, owner-approved) may show before/after usage dashboards; it still does
not convert `PRODUCTION_READY` to true.

## Decision 16 — Fake test matrix

Implementation package must ship an in-process **fake Codex app-server** (no network, no real
Codex binary) covering at least:

| Fake scenario | Expected `LlmCompletionResult` |
|---------------|--------------------------------|
| happy-path text completion | `completed` |
| abort before `turn/start` | `cancelled-before-invocation` |
| deadline before `turn/start` | `known-timeout` |
| abort after `turn/start` mid-stream | `outcome-unknown` |
| child crash after `turn/start` | `outcome-unknown` |
| malformed frame after start | `outcome-unknown` |
| forbidden approval/tool event | `policy-rejected` |
| auth/provider unavailable before start | `provider-unavailable` |
| quota unavailable | `quota-unavailable` |
| empty/invalid final agent text | `invalid-response` |
| denylisted env rejected before spawn | configuration error (no invocation) |
| pin hash/version mismatch | configuration error (no invocation) |

Real Codex binary tests remain owner-gated and outside default CI.

## Decision 17 — Manual owner-approved live probe procedure

Not executed by Build 3.7E1A. Normative future procedure:

1. Owner written approval for a single non-persistent probe.
2. Confirm account prerequisites from Build 3.7E0 §17 (credits/API keys/top-up posture as required
   by owner policy for that run).
3. Prepare isolated `CODEX_HOME` and ChatGPT OAuth offline (manual); Neo does not read credentials.
4. Install pinned executable matching version+hash tuple.
5. Run exactly one probe prompt via the E1 adapter entrypoint with Telegram absent and Neo SQLite
   prompt/output persistence hooks asserted off.
6. Capture ephemeral exit status / outcome classification only; do not copy credential files.
7. Mandatory cleanup: stop child, revoke/logout per owner plan, delete or seal probe home as owner
   directs.
8. Record whether live probe passed/failed in a later validation note — this architecture package
   remains `LIVE_PROBE: OWNER_APPROVAL_REQUIRED` and **live probe not run**.

## Decision 18 — Schema / dependency / package export decisions

- SQLite communication schema version remains unchanged by the probe route; probe must not write
  prompt/output rows to Neo communication SQLite.
- No new runtime npm dependencies are authorized by this architecture package; prefer Node
  `child_process` + existing Result/port types. Any dependency addition requires a separate
  explicit decision.
- Package root exports remain absent for probe adapters (`src/index.ts` / public barrels must not
  re-export Codex probe internals).
- `.env.example` must not gain API keys or ChatGPT tokens for this route.

## Decision 19 — Future implementation file map

Normative future paths for Build 3.7E1 (not created by 3.7E1A):

```text
src/communication/adapters/codex-app-server/create-codex-app-server-route.ts
src/communication/adapters/codex-app-server/codex-app-server-capability-probe.ts
src/communication/adapters/codex-app-server/codex-app-server-llm-completion.ts
src/communication/adapters/codex-app-server/codex-app-server-protocol.ts
src/communication/adapters/codex-app-server/codex-app-server-client.ts
src/communication/adapters/codex-app-server/codex-app-server-config.ts
src/communication/adapters/codex-app-server/codex-app-server-child-env.ts
src/communication/adapters/codex-app-server/codex-app-server-executable-pin.ts
src/communication/adapters/codex-app-server/fake/fake-codex-app-server.ts
tests/communication/codex-app-server-protocol.test.ts
tests/communication/codex-app-server-child-env.test.ts
tests/communication/codex-app-server-executable-pin.test.ts
tests/communication/codex-app-server-client.fake.test.ts
tests/communication/codex-app-server-llm-completion.fake.test.ts
tests/communication/codex-app-server-boundaries.test.ts
scripts/verify-communication-boundaries.mjs
.dependency-cruiser.cjs
scripts/lib/boundary-checker.mjs
```

Boundary verifier / depcruise changes must allow only the `codex-app-server` adapter tree to talk
to Node child_process and must keep OpenClaw adapter paths absent. Do not reunify Codex and
OpenClaw under a combined route name.

## Architecture package files (exact set)

```text
docs/validation/build-3.7e1a-codex-subscription-probe-decisions.md
tests/build-3.7e1a-codex-subscription-probe-decisions-record.test.ts
docs/communication/text-implementation-map.md
docs/communication/text-architecture.md
docs/llm-provider.md
docs/openclaw-compatibility.md
docs/acceptance-criteria.md
```

## Next stage

Implementation package for the Codex app-server stdio probe adapter may start only after this
architecture record is accepted. Live probe requires separate owner approval. Production
composition, OpenClaw integration, and durable 3.7D live wiring remain out of scope / blocked.
