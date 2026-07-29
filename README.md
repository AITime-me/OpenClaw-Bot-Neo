# OpenClaw Bot Neo

Архитектурный фундамент личного помощника владельца. Это не клиентский бот и не публичный сервис.

## Целевой продукт

Помощник объединяет ровно восемь бизнес-ролей:

1. AI Director / AI-директор над проектами.
2. Tech Watchdog / Технический сторож.
3. Integration Engineer.
4. Business Analyst / Бизнес-аналитик.
5. Marketing Strategist / Маркетинговый стратег.
6. AI Scout / парсер возможностей.
7. Personal Assistant / Личный ассистент.
8. Security Guard.

Multimodal workflow — общая техническая capability обработки текста, изображений, аудио и документов, а не девятая роль.

Первый интерфейс — Telegram через изолированный адаптер; в будущем возможен мобильный клиент. Стабильное ядро не зависит от канала.

## Принципы

- read-only-first; любое изменение внешней системы требует явного одобрения владельца;
- зарубежный VPS TimeWeb Cloud — **planned** хост помощника (не куплен, not deployed), отдельно от российского production-сервера;
- доверие одностороннее: помощник наблюдает разрешённые системы, обратного доверия к нему нет;
- основной доступ к LLM — ChatGPT Plus/Codex OAuth; автоматического перехода на API-биллинг нет;
- платные fallback-провайдеры выключены;
- секреты, персональные данные и неподтверждённые сведения не попадают в репозиторий.

## Статус

**Build №2 + Security Remediation 2.1A–2.1I: implemented contracts and pure core logic;
not deployed; pending independent verification.**

| Слой | Статус |
|------|--------|
| Target architecture | planned |
| Pure core policies / contracts | implemented |
| Trusted composition gateways | implemented |
| Telegram / OpenClaw adapters | not implemented |
| OpenClaw runtime | not implemented |
| VPS / deployment | not purchased / not deployed |
| Security approval | absent until independent Codex review |

Build 2.1B добавляет versioned declarative manifests, default-deny permission composition,
provider-independent registry/webhook contracts, отключённые examples для call-analysis и external
call service, а также мужской VoiceProfile Нео. Manifest не является кодом и не выдаёт полномочия;
подходящий мужской голос недоступен — используется text-only, без женского fallback.

Build 2.1C–2.1F: contract hardening (approval binding, sealed evidence, metadata budgets,
path-aware memory checker). Implemented in core; pending independent confirmation where noted.

Build 2.1G — FIN-001/002/003 implemented, pending independent confirmation: immutable sanitized
snapshot, opaque `AuthenticatedMemoryAccessContext` через trusted `MemoryAccessGateway`,
WeakMap/WeakSet identity membership. Package `exports` — только root API.

Build 2.1H — FIN-004/005/006 implemented, pending independent confirmation: trust/risk/policy
и deployment/voice derive через pre-bound gateways.

Build 2.1I — FIN-007—FIN-011, FIN-013, FIN-014 implemented этим Build, pending independent
confirmation. FIN-012 **PARTIALLY CLOSED / BLOCKED**: production Node contract `>=22.13.0 <23`
и review override (`OPENCLAW_REVIEW_NODE_OVERRIDE=1`) реализованы и тестируются; однако
`@types/node` в lockfile остаётся `26.1.2` — подходящий `@types/node@22` в локальном npm cache
не найден, offline upgrade без сети не выполнен. Переход к Build №3 запрещён до установки
Node 22 typings и повторной проверки на реальном Node 22.13+. FIN-012 не объявляется закрытым;
общий Build 2.1I не является security-approved.

Build №3 ещё не начат. Сервер не куплен. Deployment не разрешён. Реальных
adapters/providers/runtime/authentication нет. URL policy не является полной SSRF-защитой.

Проверка ядра: `npm run check` — non-production review/tooling runner (может выставить
`OPENCLAW_REVIEW_NODE_OVERRIDE=1` с предупреждением; это не production PASS).
Production start: `OPENCLAW_PRODUCTION_NODE_GATE=1` (override запрещён).
Публичные контракты экспортируются из `src/index.ts`.

Навигация: [архитектура](docs/architecture.md), [расширяемость](docs/extensibility.md),
[интеграции](docs/integrations.md), [VoiceProfile](docs/voice-profile.md),
[роли](docs/roles.md), [безопасность](docs/security-policy.md),
[критерии приёмки](docs/acceptance-criteria.md),
[совместимость OpenClaw](docs/openclaw-compatibility.md).
