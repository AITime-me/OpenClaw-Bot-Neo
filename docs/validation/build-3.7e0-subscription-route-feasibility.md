# Build 3.7E0 — Subscription Route Feasibility

## Machine-readable markers

```text
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
```

## 1. Build identity

| Item | Value |
|------|-------|
| Build | 3.7E0 — Subscription Route Feasibility |
| Feature branch | `build-3-7e0-subscription-route-feasibility` |
| Base commit | `35567435ebf018af63c70f58672e5dc2ca98086c` |
| Base subject | `docs(communication): correct Build 3.7A review findings` |
| Build kind | research / documentation / validation only |
| Commit subject | `docs(llm): close Build 3.7E0 subscription route feasibility` |
| Push / merge | not performed by this Build |

## 2. Scope

This record closes **Build 3.7E0** by documenting an already-completed official-source Codex
research package. It does **not**:

- perform new external research;
- create OAuth sessions, API keys, or credentials;
- install Codex CLI/SDK;
- execute model calls;
- implement adapters or runtime;
- approve live production operation;
- change billing or account settings.

AUTHORITATIVE_SECURITY_VALIDATION=false

SECURITY_APPROVAL_COMPLETE=false

DEPLOYMENT_READY=false

## 3. Original research question

The research asked whether a ChatGPT Plus / Codex **subscription** route can serve Neo as a
headless, restart-safe, machine-usable completion path **without**:

- OpenAI API-key auth;
- token-billed OpenAI Platform API;
- silent API/paid fallback;
- spending even an already-existing ChatGPT/Codex credit balance;
- and with official confirmation of owner-only Telegram/mobile backend plus 24/7 daemon support.

## 4. Research executive verdict

```text
RESEARCH_EXECUTIVE_VERDICT: FAIL_UNDER_ABSOLUTE_ZERO_PAID_FALLBACK_CRITERION
```

The composite PASS criterion required absolute impossibility of additional paid spend, including
already-purchased ChatGPT credits, plus official owner-only Telegram backend and confirmed 24/7
daemon support. Because existing ChatGPT credits can still be consumed after included Codex limits,
and because owner-only continuous backend use remains officially unresolved, the **research
executive verdict is FAIL** under that absolute criterion.

This record does **not** call that verdict an error. It separates:

1. strict research executive outcome (FAIL under absolute zero-paid-fallback criterion);
2. technical subscription-route existence (PASS);
3. Neo project strategy (retain ChatGPT/Codex as primary candidate);
4. live operational approval (UNRESOLVED).

## 5. Verified technical facts

Paraphrased from official OpenAI documentation and the official `openai/codex` repository:

1. Modern Codex exposes a distinct `auth_mode = chatgpt`.
2. ChatGPT auth mode does not require a manual OpenAI API key or mandatory API organization; it uses
   an OAuth access/ID/refresh token bundle in the Codex credential store, with refresh, logout, and
   device-code login for headless environments.
3. Machine-readable interfaces exist: Codex CLI, `codex exec`, JSONL events, Codex SDK, and
   app-server over a local transport.
4. Linux support, non-interactive execution, persistent `CODEX_HOME`, and recovery after ordinary
   restart/reboot are supported; ChatGPT login can be forced; API-key mode can be avoided.
5. ChatGPT subscription billing and OpenAI Platform API billing are distinct billing surfaces.
6. API-key mode is a separate token-billed Platform API path and remains forbidden by Neo architecture.
7. After included Codex limit exhaustion, OpenAI may consume an already-held ChatGPT/Codex credit
   balance.
8. Disabling auto top-up prevents automatic purchase of new credits but does not prevent spending
   already-acquired balance.
9. Personal Plus has no documented programmatic spend-control that forbids use of already-held
   ChatGPT credits.
10. Owner-only Telegram/mobile backend and permanent systemd daemon use are not explicitly allowed
    or explicitly forbidden for an owner-only relay via the official SDK; live operational status
    remains unresolved.
11. No 24/7 SLA for Plus was found.
12. One OAuth credential bundle must not be uncontrolledly shared by competing processes.
13. `auth.json` / Codex credentials are secret bearer/refresh material requiring isolated service
    user, closed permissions, and exclusion from Git/logs/unencrypted backups.

## 6. Authentication model

| Mode | Neo posture |
|------|-------------|
| ChatGPT OAuth (`auth_mode=chatgpt`) | Primary candidate; technically verified to exist |
| Manual API key / API-key auth mode | Forbidden |
| `OPENAI_API_KEY` / `CODEX_API_KEY` | Forbidden on subscription route |
| Silent fallback from ChatGPT auth to API-key auth | Forbidden |

## 7. Billing surfaces

| Surface | Relationship to Neo |
|---------|---------------------|
| ChatGPT Plus / Codex subscription included usage | Intended primary surface |
| Already-purchased ChatGPT/Codex credits | Additional paid spend possible; not Platform API billing |
| OpenAI Platform API token billing | Forbidden; not a fallback |

Purchased ChatGPT credits are **not** OpenAI Platform API billing, but they **are** additional paid
expense when consumed.

## 8. ChatGPT credit limitation

Neo cannot technically prevent upstream consumption of an already-existing ChatGPT credit balance.
Therefore an absolute repository guarantee of `paidFallbackEnabled=false` under the research’s
zero-additional-spend reading requires **account-level prerequisites**, not repository config alone.

```text
EXISTING_CHATGPT_CREDITS_CAN_BE_CONSUMED: TRUE
ZERO_ADDITIONAL_SPEND_GUARANTEE: ACCOUNT_PREREQUISITES_REQUIRED
```

## 9. Headless / Linux / restart feasibility

Technically verified: Linux support, non-interactive execution, persistent `CODEX_HOME`, ordinary
restart/reboot recovery, forced ChatGPT login, avoidance of API-key mode, device-code login for
headless environments.

Not verified as live Neo approval: continuous 24/7 Plus SLA, owner-approved systemd daemon policy,
or production VPS session security.

## 10. SDK / CLI / app-server feasibility

Technically verified machine-readable surfaces: Codex CLI, `codex exec`, JSONL events, Codex SDK,
local app-server transport. No Neo adapter is implemented in this Build.

## 11. Policy and operational unknowns

- Official explicit permission/prohibition for owner-only Telegram/mobile relay backend: unresolved.
- 24/7 Plus SLA: absent.
- Concurrent multi-process use of one OAuth bundle: unsafe / must be serialized.
- Capability probe against a real account: **NOT_RUN**.

## 12. Security requirements (design prerequisites; not claimed implemented)

- Isolated Linux service user;
- isolated `CODEX_HOME`;
- closed credential permissions;
- credentials never in Git/logs/unencrypted backups;
- single serialized process per OAuth bundle;
- logout/revocation cleanup plan for probes.

## 13. Technical feasibility verdict

```text
TECHNICAL_SUBSCRIPTION_ROUTE: PASS
```

A modern ChatGPT OAuth subscription route exists as a technical candidate distinct from API-key
Platform API billing.

## 14. Live operational verdict

```text
LIVE_OPERATIONAL_APPROVAL: UNRESOLVED
```

No production readiness, no security approval, no live Telegram/model route approval.

## 15. Project decision

```text
PROVIDER_STRATEGY: RETAIN_CHATGPT_CODEX_AS_PRIMARY_CANDIDATE
```

- Prior Neo architecture choosing ChatGPT Plus/Codex subscription is **not** cancelled.
- Technical existence of ChatGPT OAuth route is confirmed.
- OpenAI API key / Platform token-billed API / silent API fallback / API-key auth mode remain
  forbidden.
- No alternate provider is auto-selected.
- Absolute zero-additional-spend remains account-prerequisite gated.

## 16. Allowed and blocked stages

| Stage | Decision |
|-------|----------|
| Build 3.7B | **ALLOWED** — package-private contracts only; offline |
| Build 3.7C | **ALLOWED** — durable offline foundation; no live auth |
| Build 3.7D | **ALLOWED** — orchestrator + offline/reference/fake completion only |
| Build 3.7E1 | **BLOCKED** — pending capability probe and live gates |
| Build 3.7F | **BLOCKED** — pending E1, encryption, and operational approval |

Builds 3.7B–D must remain:

- provider-independent;
- offline / reference;
- fake completion;
- without real OpenAI/Codex authentication;
- without real model calls;
- without Telegram;
- without live deployment.

```text
NEXT_STAGE: 3.7B
```

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

```text
CAPABILITY_PROBE_STATUS: NOT_RUN
```

## 18. Explicit non-claims

- Production readiness is not claimed.
- Security approval is not claimed.
- Live-route approval is not claimed.
- Not an implementation of Codex/OpenClaw adapters.
- Not proof that absolute zero additional spend is enforceable by repository config alone.
- Not a rejection of ChatGPT/Codex as Neo’s primary provider candidate.
- Not permission to start 3.7E1/3.7F.

## 19. Residual risks

| Severity | Risk |
|----------|------|
| BLOCKER | Live route without capability probe, encryption gate, and operational approval |
| HIGH | Existing ChatGPT credits consumed despite included-limit exhaustion |
| HIGH | Competing processes sharing one OAuth bundle |
| HIGH | Credential leakage via logs/backups/Git |
| MEDIUM | Unresolved owner-only continuous daemon policy |
| MEDIUM | Absence of Plus 24/7 SLA |
| LOW | Doc drift reintroducing “E0 not yet run” after this closeout |

## 20. Closeout decision

`BUILD_3_7E0_SUBSCRIPTION_ROUTE_FEASIBILITY_CLOSED_RESEARCH_ONLY`

Final status:

`BUILD_3_7E0_READY_FOR_INDEPENDENT_REVIEW`

Next step after independent review: **Build 3.7B** (offline package-private communication contracts).

## 21. Source register (research report)

Research used only official OpenAI documentation and the official `openai/codex` repository.
Evidence in this closeout is paraphrased. Categories covered:

- Codex authentication modes (`chatgpt` vs API-key);
- OAuth credential store / refresh / logout / device-code login;
- Codex CLI, `codex exec`, JSONL, SDK, local app-server;
- Linux / non-interactive / `CODEX_HOME` persistence;
- ChatGPT subscription vs Platform API billing surfaces;
- Included Codex limits vs ChatGPT/Codex credit balance behavior;
- Auto top-up vs already-acquired credit spend;
- Absence of documented Personal Plus programmatic spend lock;
- Absence of explicit owner-only Telegram/systemd SLA statements.

Exact URLs and long quotations are intentionally omitted from this repository record.
