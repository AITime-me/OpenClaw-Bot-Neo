# LLM provider

## Политика доступа (target + verified config posture)

Default — только subscription OAuth через ChatGPT Plus/Codex при подтверждённой
runtime-совместимости.

### Repository-controlled behavior

Neo:

- не инициирует API-key fallback;
- не инициирует OpenAI Platform API route;
- не переключает provider автоматически;
- сохраняет `apiFallbackEnabled=false`;
- сохраняет `paidFallbackEnabled=false`;
- запрещает API-key auth mode;
- запрещает `OPENAI_API_KEY` и `CODEX_API_KEY`;
- запрещает token-billed OpenAI Platform API;
- запрещает silent fallback.

`paidFallbackEnabled=false` запрещает платный fallback, инициируемый или контролируемый Neo. Это
**не** upstream spend-control для ChatGPT account.

### Upstream ChatGPT account behavior

- После included subscription quota OpenAI может расходовать уже существующий ChatGPT/Codex credit
  balance.
- Repository flags не управляют upstream ChatGPT credit accounting.
- Выключенный auto top-up запрещает автоматическую покупку новых credits, но не запрещает
  использование уже имеющегося credit balance.
- ChatGPT/Codex credits не являются OpenAI Platform API billing; при расходе это дополнительный
  платный расход.

### Fail-closed after included quota

Состояние `provider unavailable` после исчерпания included quota можно ожидать только при
подтверждённых account-level prerequisites (не заявлены выполненными):

- ChatGPT/Codex credit balance = 0;
- auto top-up выключен;
- отдельно активированный paid route отсутствует;
- forced login method = chatgpt;
- `OPENAI_API_KEY` отсутствует;
- `CODEX_API_KEY` отсутствует;
- API-key auth mode отсутствует.

**Verified fact:** parsers конфигурации model-routing требуют
`defaultProviderMode: subscription-oauth-only` и `apiFallbackEnabled` / `paidFallbackEnabled` =
false. Pure `resolveRoute` существует. **Live LLM client / OAuth session / OpenClaw route в коде
отсутствуют.**

Модели не hardcode-ятся: routing опирается на абстрактные capability tiers.

Multimedia — отдельная capability и отдельный provider policy. Она не наследует LLM credentials, не
активирует платные сервисы и предпочитает локальную обработку.

## Text communication LLM port (Build 3.7A design)

Целевой порт — provider-independent tools-free `LlmCompletionPort`. См.
[text architecture](communication/text-architecture.md).

## Build 3.7E0 — Subscription Route Feasibility (closed, research-only)

Build 3.7E0 research verdict: FAIL_UNDER_ABSOLUTE_ZERO_PAID_FALLBACK_CRITERION

Build 3.7E0 technical subscription route: PASS

Build 3.7E0 live operational approval: UNRESOLVED

Build 3.7E0 provider strategy: RETAIN_CHATGPT_CODEX_AS_PRIMARY_CANDIDATE

Build 3.7E0 capability probe: NOT_RUN

Build 3.7E1A status: ARCHITECTURE_ONLY (IMPLEMENTATION_READY; LIVE_PROBE owner-approval required; live probe not run)

Build 3.7E1 status: PROBE_IMPLEMENTED (LIVE_PROBE_STATUS: EXECUTED_FAIL / provider-unavailable / pre-dispatch compatibility on codex-cli 0.147.0; durable 3.7D wiring BLOCKED_BY_ENCRYPTION)

Build 3.7E1 implementation status: IMPLEMENTED

LIVE_PROBE_STATUS: EXECUTED_FAIL

Build 3.7F status: BLOCKED

PRODUCTION_READY: FALSE

Build 3.7E0 next stage: 3.7B

**Build 3.7B (offline contracts):** `LlmCompletionPort` contract and related communication policies
are implemented package-private under `src/core/communication/`. No live model calls, provider adapter,
or root exports. Build 3.7B status: offline contracts implemented; live runtime absent.
Build 3.7E1A architecture is closed for a probe-only Codex app-server stdio route; Neo does not
read credentials; isolated `CODEX_HOME` required; API/paid fallback remain false; Neo SQLite must
not persist probe prompt/output; durable 3.7D integration remains blocked by encryption; OpenClaw
is a separate unverified / out-of-scope route. Build 3.7E1 implements that probe-only adapter with
fake coverage; first live attempt `LIVE_PROBE_STATUS: EXECUTED_FAIL` (pre-dispatch compatibility).
See [3.7E1A decisions](validation/build-3.7e1a-codex-subscription-probe-decisions.md),
[3.7E1 closeout](validation/build-3.7e1-codex-subscription-probe-closeout.md), and
[3.7B closeout](validation/build-3.7b-communication-contracts-closeout.md).

Additional norms:

- existing ChatGPT/Codex credits may be consumed;
- zero additional spend requires account-level prerequisites.

См. [3.7E0 closeout](validation/build-3.7e0-subscription-route-feasibility.md),
[ADR OAuth](adr/0002-openai-subscription-auth.md), [ADR routing](adr/0009-risk-based-model-routing.md),
[матрицу совместимости](openclaw-compatibility.md).
