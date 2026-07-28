# LLM provider

## Политика доступа

Default — только subscription OAuth через ChatGPT Plus/Codex при подтверждённой runtime-совместимости. `OPENAI_API_KEY` запрещён. API billing не является fallback; автоматический API fallback и paid fallback выключены. При сбое OAuth, исчерпании subscription quota или отсутствии совместимого runtime результат — `provider unavailable`, а не скрытая платная маршрутизация.

Subscription quota не равна API billing и не даёт права использовать API credit. Модели не hardcode-ятся: routing опирается на абстрактные capability tiers, а доступные identifiers обнаруживаются и подтверждаются при runtime validation.

Multimedia — отдельная capability и отдельный provider policy. Она не наследует LLM credentials, не активирует платные сервисы и предпочитает локальную обработку. Перед каждым provider request выполняются классификация, минимизация и sensitive-data scan.

См. [ADR OAuth](adr/0002-openai-subscription-auth.md), [ADR routing](adr/0009-risk-based-model-routing.md), [матрицу совместимости](openclaw-compatibility.md).
