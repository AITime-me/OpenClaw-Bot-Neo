# Матрица совместимости OpenClaw

## Status layers (Build 3.7E0 corrective)

OpenClaw runtime verification: UNVERIFIED

External Codex/ChatGPT prerequisite: VERIFIED_BY_BUILD_3_7E0_RESEARCH

Build 3.7E0 technical subscription route: PASS

Build 3.7E0 live operational approval: UNRESOLVED

Build 3.7E0 capability probe: NOT_RUN

Build 3.7E1A status: ARCHITECTURE_ONLY (IMPLEMENTATION_READY; live probe not run)

Build 3.7E1 status: PROBE_IMPLEMENTED (LIVE_PROBE_STATUS: NOT_RUN; durable 3.7D wiring BLOCKED_BY_ENCRYPTION)

Build 3.7E1 implementation status: IMPLEMENTED

LIVE_PROBE_STATUS: NOT_RUN

Build 3.7F status: BLOCKED

PRODUCTION_READY: FALSE

Meaning:

- existence of a modern Codex/ChatGPT technical subscription route was confirmed by Build 3.7E0
  official-source research;
- Build 3.7E1A selects a **probe-only Codex app-server stdio** route as the Neo architecture
  target; Build 3.7E1 implements that probe-only package with fake coverage;
- `LIVE_PROBE_STATUS: NOT_RUN` — no real Codex login, app-server spawn, or model call in 3.7E1;
- durable 3.7D live wiring of that Codex route remains blocked by encryption;
- compatibility of a future **OpenClaw**/Neo runtime integration was **not** verified and remains
  **OUT_OF_SCOPE** for 3.7E1A/3.7E1;
- no OpenClaw runtime, adapter, OAuth integration, capability probe, or model call was executed in
  Build 3.7E0, 3.7E1A, or 3.7E1;
- therefore OpenClaw-specific rows below remain **UNVERIFIED** for runtime verification status;
- do not read External Codex/ChatGPT prerequisite verification, 3.7E1A architecture readiness, or
  3.7E1 probe-only implementation as OpenClaw runtime PASS, live probe PASS, or production
  readiness.

Все OpenClaw-специфичные runtime-утверждения ниже — **UNVERIFIED**, пока не выполнены
reproducible runtime checks против закреплённой OpenClaw version.

| Функция (feature) | Ожидаемое поведение (expected behavior) | Источник (source) | Дата источника (source date) | Целевая версия OpenClaw (target OpenClaw version) | OpenClaw runtime verification | Runtime-проверка (runtime check) | Результат (result) | Примечания (notes) |
|---|---|---|---|---|---|---|---|---|
| Config loading | Явная schema, безопасная ошибка неизвестных полей, без unsafe defaults | official documentation reference to be pinned | TBD | proposed `2026.7.1` | UNVERIFIED | Load valid/invalid fixture and inspect effective config | TBD | Draft config не рабочий |
| AGENTS/SOUL | Загрузка только если явно документирована и наблюдаема | official documentation reference to be pinned | TBD | proposed `2026.7.1` | UNVERIFIED | Controlled guidance visibility test | TBD | Нельзя утверждать чтение файлов |
| OAuth | Subscription OAuth without API-key billing | External Codex research (Build 3.7E0) + future OpenClaw runtime check | 2026 | proposed `2026.7.1` | UNVERIFIED | Inspect actual OpenClaw process env/auth profile and billing path | TBD | External prerequisite verified by 3.7E0 research; OpenClaw runtime unverified |
| Model discovery | Capability discovery без hardcoded identifiers | official documentation reference to be pinned | TBD | proposed `2026.7.1` | UNVERIFIED | Enumerate runtime-reported capabilities | TBD | Paid fallback запрещён |
| Tools/policy | Allow/deny, scoped approvals и tool profiles нельзя обойти | official documentation reference to be pinned | TBD | proposed `2026.7.1` | UNVERIFIED | Adversarial deny/replay/escalation tests | TBD | Внешний enforcement при необходимости |
| SecretRef | Секреты разрешаются вне config и не попадают в sinks | official documentation reference to be pinned | TBD | proposed `2026.7.1` | UNVERIFIED | Synthetic SecretRef lifecycle/redaction test | TBD | Точные поля не подтверждены |
| Memory | Namespace, provenance, delete и retention изолированы | official documentation reference to be pinned | TBD | proposed `2026.7.1` | UNVERIFIED | Cross-namespace/write/delete tests | TBD | Facade при несовместимости |
| Scheduler | Timezone, quiet hours, expiry и idempotency предсказуемы | official documentation reference to be pinned | TBD | proposed `2026.7.1` | UNVERIFIED | DST/retry/duplicate/expired fixture tests | TBD | Никаких payment actions |
| Telegram channel | Temporary transport adapter only; core stays channel-independent; equal future mobile adapter | official documentation reference to be pinned | TBD | proposed `2026.7.1` | UNVERIFIED | Contract/auth/replay/redaction tests | TBD | Build 3.7F blocked |
| Subscription completion route | Headless ChatGPT Plus/Codex subscription without API-key billing | External Codex research (Build 3.7E0) + future OpenClaw runtime check | 2026 | proposed `2026.7.1` | UNVERIFIED | Account prerequisites + capability probe before E1 | TBD | External prerequisite verified by 3.7E0; OpenClaw runtime unverified; live UNRESOLVED |
| Media | Capability/limits/local-first policy применяются | official documentation reference to be pinned | TBD | proposed `2026.7.1` | UNVERIFIED | MIME/size/job cleanup fixtures | TBD | Paid providers disabled |
| Task ledger | Task state, expiry, cancellation и provenance детерминированы | official documentation reference to be pinned | TBD | proposed `2026.7.1` | UNVERIFIED | Duplicate/cancel/restart/expiry tests | TBD | Storage boundary неизвестна |
| PDF/DOCX | Парсинг ограничен MIME, size, decompression и scanner policy | official documentation reference to be pinned | TBD | proposed `2026.7.1` | UNVERIFIED | Spoofed MIME/bomb/malformed fixture tests | TBD | External upload off |
| Talk/realtime | Realtime не обходит approvals, scanner и retention | official documentation reference to be pinned | TBD | proposed `2026.7.1` | UNVERIFIED | Session/auth/interrupt/redaction tests | TBD | Disabled until verified |
| Sandbox/SSRF | Tools изолированы; URL/redirect/private targets блокируются | official documentation reference to be pinned | TBD | proposed `2026.7.1` | UNVERIFIED | Redirect, DNS/IP and path traversal tests | TBD | No elevated tools |
| Audit/redaction | Scanner и masking выполняются до audit/log sinks | official documentation reference to be pinned | TBD | proposed `2026.7.1` | UNVERIFIED | Seed synthetic secrets and inspect every sink | TBD | Fail closed |

Ни одна OpenClaw runtime-строка не переводится в Confirmed без закреплённой версии, воспроизводимого
локального теста и evidence. Draft JSON в `config/` не является рабочим OpenClaw config.

См. [3.7E0 closeout](validation/build-3.7e0-subscription-route-feasibility.md).
