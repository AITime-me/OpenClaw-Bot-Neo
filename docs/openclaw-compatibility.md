# Матрица совместимости OpenClaw

Все OpenClaw-специфичные утверждения ниже — **UNVERIFIED**. Документ не подтверждает команды, поля конфигурации, пути, model identifiers или поведение runtime.

| Функция (feature) | Ожидаемое поведение (expected behavior) | Источник (source) | Дата источника (source date) | Целевая версия OpenClaw (target OpenClaw version) | Статус проверки (verification status) | Runtime-проверка (runtime check) | Результат (result) | Примечания (notes) |
|---|---|---|---|---|---|---|---|---|
| Config loading | Явная schema, безопасная ошибка неизвестных полей, без unsafe defaults | official documentation reference to be pinned | TBD | proposed `2026.7.1` | UNVERIFIED | Load valid/invalid fixture and inspect effective config | TBD | Draft config не рабочий |
| AGENTS/SOUL | Загрузка только если явно документирована и наблюдаема | official documentation reference to be pinned | TBD | proposed `2026.7.1` | UNVERIFIED | Controlled guidance visibility test | TBD | Нельзя утверждать чтение файлов |
| OAuth | Subscription OAuth без API-key billing | official documentation reference to be pinned | TBD | proposed `2026.7.1` | UNVERIFIED | Inspect actual process env/auth profile and billing path | TBD | Failure должен быть unavailable |
| Model discovery | Capability discovery без hardcoded identifiers | official documentation reference to be pinned | TBD | proposed `2026.7.1` | UNVERIFIED | Enumerate runtime-reported capabilities | TBD | Paid fallback запрещён |
| Tools/policy | Allow/deny, scoped approvals и tool profiles нельзя обойти | official documentation reference to be pinned | TBD | proposed `2026.7.1` | UNVERIFIED | Adversarial deny/replay/escalation tests | TBD | Внешний enforcement при необходимости |
| SecretRef | Секреты разрешаются вне config и не попадают в sinks | official documentation reference to be pinned | TBD | proposed `2026.7.1` | UNVERIFIED | Synthetic SecretRef lifecycle/redaction test | TBD | Точные поля не подтверждены |
| Memory | Namespace, provenance, delete и retention изолированы | official documentation reference to be pinned | TBD | proposed `2026.7.1` | UNVERIFIED | Cross-namespace/write/delete tests | TBD | Facade при несовместимости |
| Scheduler | Timezone, quiet hours, expiry и idempotency предсказуемы | official documentation reference to be pinned | TBD | proposed `2026.7.1` | UNVERIFIED | DST/retry/duplicate/expired fixture tests | TBD | Никаких payment actions |
| Telegram channel | Channel adapter сохраняет core boundary и credentials | official documentation reference to be pinned | TBD | proposed `2026.7.1` | UNVERIFIED | Contract/auth/replay/redaction tests | TBD | Transport types не входят в core |
| Media | Capability/limits/local-first policy применяются | official documentation reference to be pinned | TBD | proposed `2026.7.1` | UNVERIFIED | MIME/size/job cleanup fixtures | TBD | Paid providers disabled |
| Task ledger | Task state, expiry, cancellation и provenance детерминированы | official documentation reference to be pinned | TBD | proposed `2026.7.1` | UNVERIFIED | Duplicate/cancel/restart/expiry tests | TBD | Storage boundary неизвестна |
| PDF/DOCX | Парсинг ограничен MIME, size, decompression и scanner policy | official documentation reference to be pinned | TBD | proposed `2026.7.1` | UNVERIFIED | Spoofed MIME/bomb/malformed fixture tests | TBD | External upload off |
| Talk/realtime | Realtime не обходит approvals, scanner и retention | official documentation reference to be pinned | TBD | proposed `2026.7.1` | UNVERIFIED | Session/auth/interrupt/redaction tests | TBD | Disabled until verified |
| Sandbox/SSRF | Tools изолированы; URL/redirect/private targets блокируются | official documentation reference to be pinned | TBD | proposed `2026.7.1` | UNVERIFIED | Redirect, DNS/IP and path traversal tests | TBD | No elevated tools |
| Audit/redaction | Scanner и masking выполняются до audit/log sinks | official documentation reference to be pinned | TBD | proposed `2026.7.1` | UNVERIFIED | Seed synthetic secrets and inspect every sink | TBD | Fail closed |

Ни одна строка не переводится в Confirmed без закреплённой версии, воспроизводимого локального теста и evidence. Draft JSON в `config/` не является рабочим OpenClaw config.
