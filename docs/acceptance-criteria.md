# Критерии приёмки

## Repository safety

- Scope содержит только согласованные foundation-документы и draft JSON; `.gitattributes` не изменён, новых runtime/source/scripts/Docker файлов нет.
- Draft config валиден как JSON, явно не deployable и не выдаётся за подтверждённый OpenClaw config.
- Config не полагается на unsafe defaults: deny/read-only/scanner/provider/embedding/paid behavior заданы явно.
- Internal Markdown links разрешаются; likely-secret scan, active-key scan, `git diff --check` и allowlist scope проходят.
- Compile, lint и format являются **future/not-applicable to this architecture foundation**, потому что executable source отсутствует; на будущем этапе они обязательны.

## LLM authentication and billing

- Default auth — subscription OAuth; subscription quota не трактуется как API billing.
- `OPENAI_API_KEY` отсутствует в tracked examples и **в фактическом environment процесса OpenClaw**; проверять только source/config недостаточно.
- `OPENAI_API_KEY` в runtime environment — critical error и блокирует startup/readiness.
- API-key auth profile — critical error; runtime не продолжает работу.
- API fallback и paid fallback выключены; скрытого fallback нет.
- При недоступности subscription provider/registry/model discovery маршрут возвращает unavailable, а не выбирает платный или неподтверждённый provider.

## Channel boundaries

- Core и будущие skills импортируют только общий channel contract; transport SDK/types/identifiers запрещены.
- Telegram существует только в adapter boundary; future mobile использует отдельный adapter к тому же core.
- Telegram bot token никогда не достигает memory или logs; synthetic test подтверждает отсутствие во всех sinks.
- Sender/recipient references opaque, allowlisted и не являются доказательством полномочий; replay/rate/size checks применяются на adapter boundary.

## Media

- Multimodal workflow — capability, не девятая роль; media facade отделён от LLM и channels.
- MIME определяется по содержимому и allowlist, а не только extension/header; MIME spoofing блокируется.
- URL fetch запрещает loopback, link-local, private/internal ranges, unsafe schemes, DNS rebinding и credential-bearing URL; каждый redirect повторно проходит SSRF policy.
- PDF/DOCX и архивные inputs имеют size/page/entry/decompression limits; decompression bombs и malformed payloads блокируются.
- Media jobs имеют idempotency key, cancel, cleanup и expiry; повтор не создаёт второй external action.
- External/paid processing выключен, пока capability/provider/privacy не подтверждены.

## Memory

- Разрешены только согласованные namespaces; cross-namespace read/write deny-by-default.
- Каждая запись содержит provenance, source date, confidence, classification и retention; unverified claims не становятся фактами.
- Secret in ordinary string блокируется до memory; TypeScript/static type не считается защитой.
- URL credentials блокируются или маскируются до любого sink.
- Private key block никогда не достигает memory/logs.
- Telegram bot token никогда не достигает memory/logs.
- Scanner unavailable => write denied; timeout/ambiguity/limit также fail closed.
- Delete удаляет сырьё и derived/index entries, оставляя только минимальный redacted audit; результат удаления проверяется.
- Memory embedding provider указан явно (`none` или проверенный local placeholder); внешний provider не выбирается default-ом.

## Automation

- Reminder требует timezone, quiet hours, owner-visible expiry и idempotency; duplicate/retry не создаёт повторную доставку.
- Expired reminder не исполняется; missed run и quiet-hours behavior детерминированы.
- Изменение reminders/subscriptions/quotas требует owner approval и audit.
- Financial/subscription automation только наблюдает и уведомляет; payment, purchase, renewal и cancellation actions отсутствуют.
- Task ledger обеспечивает provenance, idempotency, cancellation, cleanup и expiry либо capability помечается unavailable.

## Model routing

- Routes включают low, medium, high и untrusted; каждый задаёт explicit tool profile, approval и onUnavailable.
- Нет hardcoded confirmed model identifiers: используются только runtime-validated capability tiers.
- High-risk никогда не fallback-ится на weak tier; untrusted content получает no-exec/no-elevated-tools profile.
- Registry unavailable, unknown tier или policy mismatch дают fail-closed unavailable.

## Security

- SensitiveDataScannerPort детерминированно работает до memory, log, external call и audit.
- Сканируются API keys, bearer credentials, Telegram bot tokens, passwords, cookies, private keys, recovery codes, URL credentials, connection strings и arbitrary text.
- Scanner unavailable => write denied; маскирование не раскрывает совпавшее значение.
- Prompt injection и memory poisoning не меняют policy, approvals, provenance или trusted instructions.
- SSRF, path traversal, MIME spoofing и decompression bombs покрыты негативными тестами.
- Tool profile ограничивает capabilities/targets/time/size; elevated tools запрещены.
- Public sharing private/restricted data запрещён; cross-border передача минимизируется и требует policy/approval.
- Safe refusal сообщает класс блокировки и следующий безопасный шаг без секрета.

## Deployment

- Bot VPS TimeWeb Cloud отделён от российского production; только outbound read-only к allowlisted production/external systems, reverse trust отсутствует.
- Bind loopback-first, inbound restricted, non-root, secrets outside repo, отдельные backup/data/audit boundaries.
- Version pin и controlled update включают release review, staging fixture tests, snapshot/rollback и compatibility matrix.
- Deployment остаётся draft и сейчас не выполняется.

## Checks after runtime installation

- Закрепить фактическую OpenClaw version и выполнить каждую runtime check из [матрицы совместимости](openclaw-compatibility.md).
- Проверить **actual OpenClaw process environment**, а не только source: наличие `OPENAI_API_KEY` — critical error.
- Проверить effective auth profiles: любой API-key auth profile — critical error.
- Проверить effective config на unsafe defaults, provider/registry fallback, explicit memory embedding provider и paid providers off.
- Выполнить adversarial tests scanner sinks, policy bypass/replay, channel boundary, tool profiles, SSRF redirects, media jobs, memory isolation/delete и scheduler idempotency.
- Future source stage обязан пройти compile, lint, format, unit/contract/security tests; для текущего foundation это not applicable.
