# LLM provider

## Политика доступа (target + verified config posture)

Default — только subscription OAuth через ChatGPT Plus/Codex при подтверждённой
runtime-совместимости. `OPENAI_API_KEY` запрещён. API billing не является fallback; автоматический
API fallback и paid fallback выключены. При сбое OAuth, исчерпании subscription quota или
отсутствии совместимого runtime результат — `provider unavailable`, а не скрытая платная
маршрутизация.

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

## Subscription route hypothesis — Build 3.7E0 gate

Архитектурная цель subscription auth **не доказана** этим репозиторием как допустимый 24/7 headless
backend, machine-usable completion interface, restart-safe authentication, отсутствие interactive
session dependency, отсутствие скрытого API billing, provider-policy compatibility или VPS session
security.

Следующий обязательный технический gate: **Build 3.7E0 — Subscription Route Feasibility**
(`PASS` | `FAIL` | `UNRESOLVED`) **до** значительной implementation-затраты Builds 3.7B–D.
Пока verdict не `PASS`, live provider route implementation запрещена.

См. [ADR OAuth](adr/0002-openai-subscription-auth.md), [ADR routing](adr/0009-risk-based-model-routing.md),
[матрицу совместимости](openclaw-compatibility.md),
[3.7A closeout](validation/build-3.7a-text-communication-design-closeout.md).
