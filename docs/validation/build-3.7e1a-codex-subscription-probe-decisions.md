# Build 3.7E1A — Codex Subscription Probe Decisions

Build 3.7E1A records the **architecture-only** decision package for a probe-only Codex
app-server subscription route. It freezes auth, isolation, allowlist, and persistence
boundaries before any adapter implementation package. No live probe, no durable 3.7D wiring,
no OpenClaw route confirmation, no production composition.

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

## Decision 1 — Probe-only Codex app-server stdio route

The only subscription probe route authorized by this package is a **Codex app-server** adapter
speaking over **stdio**.

- Scope is **probe-only**: one owner-approved, non-persistent capability probe.
- The route is not production composition and does not open continuous daemon LLM traffic.
- Implementation may proceed only as a later implementation package that preserves these
  boundaries.

## Decision 2 — Codex-managed ChatGPT OAuth; Neo never reads credentials

Authentication remains **Codex-managed ChatGPT OAuth**.

- Neo must not read, parse, copy, log, or persist Codex/ChatGPT credential material.
- Neo must not invent a parallel OAuth client for this probe route.
- Credential files under the isolated Codex home stay outside Neo SQLite and Neo audit sinks.

## Decision 3 — Isolated CODEX_HOME and pinned executable

Probe execution requires an **isolated `CODEX_HOME`**.

- Shared or developer-default Codex homes are forbidden for the Neo probe.
- The Codex executable must be **pinned by version and content hash**.
- Unpinned PATH resolution is forbidden for the probe route.

## Decision 4 — Strict env / config / event allowlists

The probe process may receive only an explicit allowlist of environment variables, config
keys, and event kinds.

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

## Next stage

Implementation package for the Codex app-server stdio probe adapter may start only after this
architecture record is accepted. Live probe requires separate owner approval. Production
composition, OpenClaw integration, and durable 3.7D live wiring remain out of scope / blocked.
