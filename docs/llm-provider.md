# LLM provider

## Политика доступа (target + verified config posture)

Default — только subscription OAuth через ChatGPT Plus/Codex при подтверждённой
runtime-совместимости. `OPENAI_API_KEY` и `CODEX_API_KEY` запрещены. API billing не является
fallback; автоматический API fallback и paid fallback выключены. При сбое OAuth, исчерпании
subscription quota или отсутствии совместимого runtime результат — `provider unavailable`, а не
скрытая платная маршрутизация.

**Verified fact:** parsers конфигурации model-routing требуют
`defaultProviderMode: subscription-oauth-only` и `apiFallbackEnabled` / `paidFallbackEnabled` =
false. Pure `resolveRoute` существует. **Live LLM client / OAuth session / OpenClaw route в коде
отсутствуют.**

Subscription quota не равна API billing и не даёт права использовать API credit. Модели не
hardcode-ятся: routing опирается на абстрактные capability tiers, а доступные identifiers
обнаруживаются и подтверждаются при runtime validation.

Multimedia — отдельная capability и отдельный provider policy. Она не наследует LLM credentials, не
активирует платные сервисы и предпочитает локальную обработку. Перед каждым provider request
выполняются классификация, минимизация и sensitive-data scan.

## Text communication LLM port (Build 3.7A design)

Целевой порт — provider-independent tools-free `LlmCompletionPort`: bounded I/O, timeout,
cancellation, explicit outcomes including `outcome-unknown`. Tools/functions/connector/infrastructure
registries отсутствуют. См. [text architecture](communication/text-architecture.md).

## Build 3.7E0 — Subscription Route Feasibility (closed, research-only)

Build 3.7E0 закрыт как research/documentation record. Официальное исследование Codex зафиксировано
без нового network research в этом Build.

Separated verdicts:

| Layer | Verdict |
|-------|---------|
| Research executive (absolute zero-paid-fallback criterion) | `FAIL_UNDER_ABSOLUTE_ZERO_PAID_FALLBACK_CRITERION` |
| `TECHNICAL_SUBSCRIPTION_ROUTE` | `PASS` |
| `LIVE_OPERATIONAL_APPROVAL` | `UNRESOLVED` |
| `PROVIDER_STRATEGY` | `RETAIN_CHATGPT_CODEX_AS_PRIMARY_CANDIDATE` |

Ключевые факты:

- ChatGPT auth mode (`auth_mode=chatgpt`) технически подтверждён и не требует manual API key;
- OpenAI Platform API / API-key auth / token-billed API / silent API fallback запрещены;
- already-purchased ChatGPT credits могут расходоваться после included Codex limit — это не Platform
  API billing, но дополнительный платный расход;
- абсолютная гарантия zero-additional-spend требует account-level prerequisites, не только
  repository config;
- capability probe = `NOT_RUN`;
- Builds 3.7B–D разрешены только offline/reference/fake completion;
- Build 3.7E1 и 3.7F заблокированы до capability probe и live gates;
- следующий implementation stage = **3.7B**.

См. [3.7E0 closeout](validation/build-3.7e0-subscription-route-feasibility.md),
[ADR OAuth](adr/0002-openai-subscription-auth.md), [ADR routing](adr/0009-risk-based-model-routing.md),
[матрицу совместимости](openclaw-compatibility.md).
