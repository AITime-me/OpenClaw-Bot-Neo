# Build 3.7E0 — Subscription Route Feasibility

## Machine-readable markers

```text
BEGIN_BUILD_3_7E0_MARKERS
BUILD_ID: 3.7E0
BUILD_KIND: RESEARCH_ONLY
IMPLEMENTATION_STATUS: ABSENT
RESEARCH_EXECUTIVE_VERDICT: FAIL_UNDER_ABSOLUTE_ZERO_PAID_FALLBACK_CRITERION
TECHNICAL_SUBSCRIPTION_ROUTE: PASS
LIVE_OPERATIONAL_APPROVAL: UNRESOLVED
PROVIDER_STRATEGY: RETAIN_CHATGPT_CODEX_AS_PRIMARY_CANDIDATE
CHATGPT_AUTH_MODE: VERIFIED
MANUAL_API_KEY_REQUIRED: FALSE
OPENAI_PLATFORM_API_ALLOWED: FALSE
API_KEY_FALLBACK_ALLOWED: FALSE
TOKEN_BILLED_API_ALLOWED: FALSE
EXISTING_CHATGPT_CREDITS_CAN_BE_CONSUMED: TRUE
ZERO_ADDITIONAL_SPEND_GUARANTEE: ACCOUNT_PREREQUISITES_REQUIRED
CAPABILITY_PROBE_STATUS: NOT_RUN
BUILD_3_7B_D_STATUS: OFFLINE_ONLY_ALLOWED
BUILD_3_7E1_STATUS: BLOCKED
BUILD_3_7F_STATUS: BLOCKED
NEXT_STAGE: 3.7B
PRODUCTION_READY: FALSE
SECURITY_APPROVED: FALSE
END_BUILD_3_7E0_MARKERS
```

## Status (human-readable)

Build 3.7E0 research verdict: FAIL_UNDER_ABSOLUTE_ZERO_PAID_FALLBACK_CRITERION

Build 3.7E0 technical subscription route: PASS

Build 3.7E0 live operational approval: UNRESOLVED

Build 3.7E0 provider strategy: RETAIN_CHATGPT_CODEX_AS_PRIMARY_CANDIDATE

Build 3.7E0 capability probe: NOT_RUN

Build 3.7E1 status: BLOCKED

Build 3.7F status: BLOCKED

Build 3.7E0 next stage: 3.7B

## 1. Build identity

| Item | Value |
|------|-------|
| Build | 3.7E0 — Subscription Route Feasibility |
| Feature branch | `build-3-7e0-subscription-route-feasibility` |
| Base commit | `35567435ebf018af63c70f58672e5dc2ca98086c` |
| Design closeout commit | `4be2d5bed978ff5944e5944d5053ddc5cd9f0336` |
| Corrective subject | `docs(llm): correct Build 3.7E0 review findings` |
| Build kind | research / documentation / validation only |
| Push / merge | not performed by this Build |

## 2. Scope

This record closes **Build 3.7E0** by documenting an already-completed official-source Codex
research package, including the documentation corrective for review findings E0-R01—E0-R05. It does
**not**:

- perform new external research;
- create OAuth sessions, API keys, or credentials;
- install Codex CLI/SDK;
- execute model calls;
- implement adapters or runtime;
- approve live production operation;
- change billing or account settings.

## 3. Original research question

The research asked whether a ChatGPT Plus / Codex **subscription** route can serve Neo as a
headless, restart-safe, machine-usable completion path **without**:

- OpenAI API-key auth;
- token-billed OpenAI Platform API;
- silent API/paid fallback;
- spending even an already-existing ChatGPT/Codex credit balance;
- and with official confirmation of owner-only Telegram/mobile backend plus 24/7 daemon support.

## 4. Research executive verdict

Build 3.7E0 research verdict: FAIL_UNDER_ABSOLUTE_ZERO_PAID_FALLBACK_CRITERION

The composite PASS criterion required absolute impossibility of additional paid spend, including
already-purchased ChatGPT credits, plus official owner-only Telegram backend and confirmed 24/7
daemon support. Because existing ChatGPT credits can still be consumed after included Codex limits,
and because owner-only continuous backend use remains officially unresolved, the research executive
verdict is FAIL under that absolute criterion.

This record does **not** call that verdict an error. It separates:

1. strict research executive outcome (FAIL under absolute zero-paid-fallback criterion);
2. technical subscription-route existence (PASS);
3. Neo project strategy (retain ChatGPT/Codex as primary candidate);
4. live operational approval (UNRESOLVED).

## 5. Verified technical facts (with source mapping)

Paraphrased evidence only; see canonical source register §21.

1. Modern ChatGPT OAuth / `auth_mode=chatgpt` exists (SRC-01, SRC-02, SRC-11, SRC-12).
2. ChatGPT auth stores OAuth access/ID/refresh material, refreshes, supports logout and device-code
   login, and does not require a manual API key (SRC-01, SRC-02, SRC-11, SRC-12).
3. Machine-readable CLI/SDK surfaces exist: `codex exec`, JSONL, TypeScript/Python SDK, local
   app-server (SRC-03, SRC-04, SRC-10, SRC-11).
4. Linux/headless/non-interactive execution and credential reuse via persistent home/auth store are
   documented (SRC-01, SRC-02, SRC-03).
5. Codex is included in ChatGPT plans with approximate plan limits (SRC-05, SRC-07).
6. After included usage, an available ChatGPT/Codex credit balance may be consumed (SRC-06).
7. ChatGPT subscription billing and OpenAI Platform API billing are separate surfaces (SRC-05,
   SRC-08).
8. Historical/launch-era Help Center material describes a generated API-key promotion flow; it is
   **not** the definitive modern ChatGPT OAuth description (SRC-09).
9. Terms/policies leave owner-only continuous daemon/Telegram relay ambiguous (SRC-13, SRC-14).
10. Personal-plan data/training controls are documented separately from CLI credential security
    (SRC-15).
11. API-key mode remains a distinct token-billed Platform path and is forbidden by Neo architecture.
12. One OAuth credential bundle must not be uncontrolledly shared by competing processes (SRC-02).
13. Codex credentials are secret bearer/refresh material requiring isolated service user and closed
    permissions.

## 6. Authentication model

| Mode | Neo posture |
|------|-------------|
| ChatGPT OAuth (`auth_mode=chatgpt`) | Primary candidate; technically verified to exist |
| Manual API key / API-key auth mode | Forbidden |
| Environment variables `OPENAI_API_KEY` and `CODEX_API_KEY` | Forbidden on subscription route |
| Silent fallback from ChatGPT auth to API-key auth | Forbidden |

## 7. Billing surfaces and repository vs upstream responsibility

### Repository-controlled behavior

Neo:

- does not initiate API-key fallback;
- does not initiate OpenAI Platform API route;
- does not auto-switch providers;
- keeps `apiFallbackEnabled` false;
- keeps `paidFallbackEnabled` false;
- forbids API-key auth mode;
- forbids environment variables `OPENAI_API_KEY` and `CODEX_API_KEY`;
- forbids token-billed Platform API;
- forbids silent fallback.

`paidFallbackEnabled=false` forbids paid fallback initiated or controlled by Neo. It is **not** an
upstream spend-control for the ChatGPT account.

### Upstream ChatGPT account behavior

- After included subscription quota, OpenAI may consume an already-existing ChatGPT/Codex credit
  balance (SRC-06).
- Repository flags do not control upstream ChatGPT credit accounting.
- Disabled auto top-up prevents automatic purchase of **new** credits; it does **not** prevent use
  of already-acquired credit balance.
- ChatGPT/Codex credits are **not** OpenAI Platform API billing; they remain additional paid spend
  when consumed.

### Fail-closed expectation after included quota

`provider unavailable` after included-quota exhaustion may be expected only when account-level
prerequisites are confirmed (not claimed verified yet):

- ChatGPT/Codex credit balance = 0;
- auto top-up disabled;
- no separately activated paid route;
- forced login method = chatgpt;
- no `OPENAI_API_KEY`;
- no `CODEX_API_KEY`;
- no API-key auth mode.

Build 3.7E0 capability probe: NOT_RUN

Build 3.7E0 live operational approval: UNRESOLVED

Build 3.7E1 status: BLOCKED

Build 3.7F status: BLOCKED

## 8. ChatGPT credit limitation

Existing ChatGPT/Codex credits may be consumed. Absolute zero-additional-spend is not a repository
guarantee; it requires account-level prerequisites.

## 9. Headless / Linux / restart feasibility

Technically verified via SRC-01, SRC-02, SRC-03: non-interactive execution, credential reuse, and
headless-oriented login options. Not verified as live Neo approval: continuous 24/7 Plus SLA or
owner-approved systemd daemon policy.

## 10. SDK / CLI / app-server feasibility

Technically verified via SRC-03, SRC-04, SRC-10, SRC-11. No Neo adapter is implemented in this Build.

## 11. Policy and operational unknowns

- Owner-only Telegram/mobile relay backend: unresolved (SRC-13, SRC-14; also not granted by
  SRC-01/SRC-03/SRC-07).
- 24/7 Plus SLA: absent.
- Concurrent multi-process OAuth use: unsafe / must be serialized.
- Capability probe: NOT_RUN.

## 12. Security requirements (design prerequisites; not claimed implemented)

- Isolated Linux service user;
- isolated `CODEX_HOME`;
- closed credential permissions;
- credentials never in Git/logs/unencrypted backups;
- single serialized process per OAuth bundle;
- logout/revocation cleanup plan for probes.

## 13. Technical feasibility verdict

Build 3.7E0 technical subscription route: PASS

A modern ChatGPT OAuth subscription route exists as a technical candidate distinct from API-key
Platform API billing.

## 14. Live operational verdict

Build 3.7E0 live operational approval: UNRESOLVED

Production readiness is not claimed. Security approval is not claimed. Live Telegram/model route
approval is not claimed.

## 15. Project decision

Build 3.7E0 provider strategy: RETAIN_CHATGPT_CODEX_AS_PRIMARY_CANDIDATE

- Prior Neo architecture choosing ChatGPT Plus/Codex subscription is not cancelled.
- Technical existence of ChatGPT OAuth route is confirmed.
- OpenAI Platform API, API-key auth, token-billed API, and silent fallback remain forbidden.
- No alternate provider is auto-selected.
- Absolute zero-additional-spend remains account-prerequisite gated.

## 16. Allowed and blocked stages

| Stage | Decision |
|-------|----------|
| Build 3.7B | ALLOWED — package-private contracts only; offline |
| Build 3.7C | ALLOWED — durable offline foundation; no live auth |
| Build 3.7D | ALLOWED — orchestrator + offline/reference/fake completion only |
| Build 3.7E1 | BLOCKED — pending capability probe and live gates |
| Build 3.7F | BLOCKED — pending E1, encryption, and operational approval |

Builds 3.7B–D must remain provider-independent, offline/reference, fake completion, without real
OpenAI/Codex authentication, without real model calls, without Telegram, without live deployment.

Build 3.7E0 next stage: 3.7B

## 17. Future isolated capability probe prerequisites

Not claimed completed. Required before any future capability probe:

- ChatGPT/Codex credit balance = 0;
- auto top-up disabled;
- API dashboard checked; API payment route unused;
- no `OPENAI_API_KEY` / `CODEX_API_KEY`;
- Codex forced login method = chatgpt;
- isolated `CODEX_HOME` and Linux service user;
- one serialized process;
- owner-approved one-call dry-run;
- before/after ChatGPT usage and API dashboard checks;
- mandatory logout/revocation cleanup plan;
- Telegram absent during probe.

Build 3.7E0 capability probe: NOT_RUN

## 18. Explicit non-claims

- Production readiness is not claimed.
- Security approval is not claimed.
- Live-route approval is not claimed.
- Not an implementation of Codex/OpenClaw adapters.
- Not proof that absolute zero additional spend is enforceable by repository config alone.
- Not a rejection of ChatGPT/Codex as Neo’s primary provider candidate.
- Not permission to start 3.7E1/3.7F.
- OpenClaw runtime compatibility remains unverified (see compatibility matrix).

## 19. Residual risks

| Severity | Risk |
|----------|------|
| BLOCKER | Live route without capability probe, encryption gate, and operational approval |
| HIGH | Existing ChatGPT credits consumed despite included-limit exhaustion |
| HIGH | Competing processes sharing one OAuth bundle |
| HIGH | Credential leakage via logs/backups/Git |
| MEDIUM | Unresolved owner-only continuous daemon policy |
| MEDIUM | Absence of Plus 24/7 SLA |
| LOW | Doc drift reintroducing obsolete historical wording as current status |

## 20. Closeout decision

Disposition: BUILD_3_7E0_SUBSCRIPTION_ROUTE_FEASIBILITY_CLOSED_RESEARCH_ONLY

Final status: BUILD_3_7E0_READY_FOR_FOCUSED_INDEPENDENT_REREVIEW

Next step after focused re-review of the corrective diff: Build 3.7B (offline package-private
communication contracts).

## 21. Canonical source register

BEGIN_BUILD_3_7E0_SOURCE_REGISTER

### SRC-01

- Title: Codex Authentication
- URL: https://developers.openai.com/codex/auth
- Publisher/domain: developers.openai.com
- Date: date not displayed; accessed 2026-08-05
- Confirms: ChatGPT and API-key authentication modes; OAuth credential storage; automatic refresh;
  device authentication; forced_login_method.
- Limitation: no explicit owner-only Telegram relay permission; not a long-running backend contract.

### SRC-02

- Title: Advanced CI/CD authentication
- URL: https://developers.openai.com/codex/auth/ci-cd-auth
- Publisher/domain: developers.openai.com
- Date: date not displayed; accessed 2026-08-05
- Confirms: ChatGPT-managed auth.json on trusted runner; refresh/reseed behavior; serialized
  credential use.
- Limitation: API key remains a widely documented automation path; not a 24/7 personal daemon
  contract.

### SRC-03

- Title: Codex non-interactive mode
- URL: https://developers.openai.com/codex/non-interactive
- Publisher/domain: developers.openai.com
- Date: date not displayed; accessed 2026-08-05
- Confirms: codex exec; JSONL and machine-readable execution; reuse of saved CLI authentication.
- Limitation: no SLA; no explicit Telegram/backend use-case permission.

### SRC-04

- Title: Codex SDK
- URL: https://developers.openai.com/codex/sdk
- Publisher/domain: developers.openai.com
- Date: date not displayed; accessed 2026-08-05
- Confirms: official TypeScript and Python SDK; programmatic control of local Codex.
- Limitation: oriented primarily to coding-agent workflows; not policy approval of a general
  conversational backend.

### SRC-05

- Title: Codex pricing
- URL: https://developers.openai.com/codex/pricing
- Publisher/domain: developers.openai.com
- Date: date not displayed; accessed 2026-08-05
- Confirms: Codex included in ChatGPT plans; plan limits; ChatGPT/Codex credits; separate API-key
  pricing surface.
- Limitation: limits are approximate and may change.

### SRC-06

- Title: Using Credits for Flexible Usage in ChatGPT
- URL: https://help.openai.com/en/articles/12642688
- Publisher/domain: help.openai.com
- Date: Help Center displayed an update approximately 9 days before access; accessed 2026-08-05
- Confirms: available ChatGPT/Codex credit balance may be consumed after included usage; auto top-up
  is a separate optional setting.
- Limitation: no personal-plan control that forbids spending an already-existing credit balance.

### SRC-07

- Title: Using Codex with your ChatGPT plan
- URL: https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan
- Publisher/domain: help.openai.com
- Date: Help Center displayed a recent relative update date; accessed 2026-08-05
- Confirms: Codex included in ChatGPT Plus; supported Codex client surfaces; general plan usage
  limits.
- Limitation: owner-only third-party messenger backend is not documented.

### SRC-08

- Title: ChatGPT subscription and API billing are separate
- URL: https://help.openai.com/en/articles/8156019
- Publisher/domain: help.openai.com
- Date: Help Center displayed an update approximately 23 days before access; accessed 2026-08-05
- Confirms: ChatGPT subscription billing and OpenAI Platform API billing are different billing
  surfaces.
- Limitation: does not describe all Codex OAuth technical details.

### SRC-09

- Title: Codex CLI and Sign in with ChatGPT
- URL: https://help.openai.com/en/articles/11381614-api-codex-cli-and-sign-in-with-chatgpt
- Publisher/domain: help.openai.com
- Date: Help Center displayed an update approximately 2 months before access; accessed 2026-08-05
- Confirms: historical/launch-era promotion flow relating API account, generated API key, and API
  credits.
- Limitation: launch-era details; not marked deprecated; must not be treated as the definitive
  modern ChatGPT OAuth description.

### SRC-10

- Title: OpenAI Codex TypeScript SDK README
- URL: https://github.com/openai/codex/blob/main/sdk/typescript/README.md
- Repository: openai/codex
- Date: main branch; accessed 2026-08-05
- Confirms: TypeScript SDK manages local Codex CLI; provides a machine-readable programmatic
  interface.
- Limitation: main branch may change; not a stable policy, compatibility, or SLA contract.

### SRC-11

- Title: OpenAI Codex app-server README
- URL: https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md
- Repository: openai/codex
- Date: main branch; accessed 2026-08-05
- Confirms: app-server protocol; separation of ChatGPT and API-key authentication; local
  machine-readable transport.
- Limitation: main branch may change; experimental transports are not a production guarantee.

### SRC-12

- Title: OpenAI Codex login server source
- URL: https://github.com/openai/codex/blob/main/codex-rs/login/src/server.rs
- Repository: openai/codex
- Date: main branch; accessed 2026-08-05
- Confirms: implementation evidence of the modern ChatGPT token/login bundle.
- Limitation: source implementation is not a policy promise or stable compatibility contract.

### SRC-13

- Title: Rest-of-world Terms of Use
- URL: https://openai.com/policies/row-terms-of-use/
- Publisher/domain: openai.com
- Date: published/effective 2026-01-01
- Confirms: account ownership and sharing rules; restrictions on bypassing rate limits; restrictions
  on scraping and undocumented access; absence of availability guarantee.
- Limitation: does not specially classify owner-only Codex Telegram relay.

### SRC-14

- Title: Service Terms
- URL: https://openai.com/policies/service-terms/
- Publisher/domain: openai.com
- Date: updated 2026-06-12
- Confirms: additional terms for Codex and beta services.
- Limitation: no explicit approval of persistent personal-plan daemon or proxy use.

### SRC-15

- Title: How does ChatGPT use my data?
- URL: https://help.openai.com/en/articles/8983130-how-does-chatgpt-use-my-data
- Publisher/domain: help.openai.com
- Date: accessed 2026-08-05
- Confirms: personal-plan data and training controls.
- Limitation: not a CLI credential-security specification.

END_BUILD_3_7E0_SOURCE_REGISTER

No unofficial sources are included. Long verbatim quotations are intentionally omitted.
