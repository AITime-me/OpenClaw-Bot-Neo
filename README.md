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

**Build №2 + Security Remediation 2.1A–2.1J-R4: implemented contracts and pure core logic;
not deployed; pending independent Codex Review №6.**

**Build 3.0 (Host Boundary and Local Composition Root): implemented; adversarial review APPROVE;
pending Codex Review №6.** App-private `src/host` composition; in-memory ephemeral stores;
deny-by-default memory policy; read/write authorization enforced; composition creates no built-in
network clients; absolute network sandbox isolation is not enforced.

**Build 3.1 implemented; pending Codex Review №6.** Pure local config bootstrap
(`parseLocalHostConfig` / `createLocalHostFromConfig`): explicit parsed-object envelope only;
four status-A families via existing core parsers; immutable snapshot; no file I/O, JSON text, env,
credentials, provider activation, OpenClaw/Telegram/OAuth, production entrypoint, or persistent
storage.

**Build 3.2 storage boundary and schema contract implemented locally, pending independent
adversarial re-review and Codex Review №6.** App-private pure storage binding request,
lexical-only explicit path policy (win32 denies ADS colons and classic reserved device names),
schema-version compatibility against immutable `CURRENT_STORAGE_SCHEMA_VERSION` only (no caller
currentVersion override), and immutable unbound storage plan. Filesystem is not read or modified;
storage backend remains unbound; durability none; writes disabled; migrations disabled; encryption
absent. No durable MemoryPort/ApprovalPort/audit, no SQLite/npm persistence dependency, no core
transaction boundary. Storage input is constructor/binding input for a future adapter — not part of
the Build 3.1 config envelope and not a claim that a disk schema exists or that a lexical path is
filesystem-open-safe.

| Слой | Статус |
|------|--------|
| Target architecture | planned |
| Pure core policies / contracts | implemented |
| Trusted composition gateways | implemented |
| App-private local host composition (Build 3.0) | implemented (ephemeral / non-durable) |
| Pure local config bootstrap (Build 3.1) | implemented (parsed-object only) |
| Storage boundary & schema contract (Build 3.2) | implemented (lexical / unbound / no I/O) |
| Telegram / OpenClaw adapters | not implemented |
| OpenClaw runtime | not implemented |
| VPS / deployment | not purchased / not deployed |
| Security approval | absent pending independent Codex Review №6 |

Build 2.1B добавляет versioned declarative manifests, default-deny permission composition,
provider-independent registry/webhook contracts, отключённые examples для call-analysis и external
call service, а также мужской VoiceProfile Нео. Manifest не является кодом и не выдаёт полномочия;
подходящий мужской голос недоступен — используется text-only, без женского fallback.

Build 2.1C–2.1F: contract hardening (approval binding, sealed evidence, metadata budgets,
path-aware memory checker). Implemented in core; pending independent confirmation where noted.

Build 2.1G — FIN-001/002/003 foundations implemented: immutable sanitized
snapshot, opaque `AuthenticatedMemoryAccessContext` через trusted `MemoryAccessGateway`,
WeakMap/WeakSet identity membership. Package `exports` — только root API.

Build 2.1H — FIN-004/005/006 foundations implemented: trust/risk/policy
и deployment/voice derive через pre-bound gateways.

Build 2.1J-R4 — точечное закрытие REV9-001 (generator executeMemoryWrite target)
**implemented, pending independent Codex Review №6**. Recognized `function*` /
`async function*` targets fail closed as `UNSUPPORTED_CONTROL_FLOW` before stage accounting.

Build 2.1J-R3 — финальное ужесточение memory isolation checker по REV8-001/REV8-002
**implemented, pending independent Codex Review №6**. Target-specific AST allowlist:
labels/loops/switch/try/break/continue → `UNSUPPORTED_CONTROL_FLOW` даже без stages;
approval-required condition — только AST (без getText в security decision).

Build 2.1J-R2 — корректирующий проход по REV7-001/REV7-002 (и REV7-003 expression-container
policy) **implemented, pending independent Codex Review №6**. Memory checker fail-closed на
unreachable stages после return/throw и на naked approval lookup/validate/consume вне canonical
gated AST sequence; security stages нельзя скрывать в object/array/ternary/logical containers.

Build 2.1J-R1 — корректирующий проход по CR5-001—CR5-008, REV6-001—REV6-010 и связанным
FIN-002/004/006/008/009/011/013/014 **implemented, pending independent Codex Review №6**. Реализованы full-envelope webhook binding и recursive immutable snapshots,
authorization-before-replay ordering, AST-only approval/clock/memory-stage checks, semantic exact
schemas для всех status-C families, runtime identity parsers и quality-check spawning без shell.
Windows npm fallback допускается только после realpath-привязки к фактической Node/npm installation
и является исключительно local review tooling, а не production runtime path.

FIN-012 **CLOSED / VERIFIED**: production runtime contract `Node >=22.13.0 <23` подтверждён на
реальном Node **22.13.0** (npm **10.9.2**) со strict gate `OPENCLAW_PRODUCTION_NODE_GATE=1` и без
`OPENCLAW_REVIEW_NODE_OVERRIDE`. Typings: exact pin `@types/node@22.13.10` (undici-types 6.20.0).
Полный suite на этом runtime: 21 files / 547 tests PASS; boundaries/secrets/hygiene PASS.
Закрытие FIN-012 не означает production-ready проект.
Build 2.1J-R4 не является security-approved (Codex Review №6 pending).

**Build 3.0 implementation revised after adversarial review; pending independent re-review and
Codex Review №6.** Появился app-private слой `src/host` с local-only composition root
(`createLocalHost`): in-memory ephemeral stores, deny-by-default memory policy, read/write
authorization via public `authorizeMemoryAccess`, composition не создаёт built-in network clients,
абсолютная network sandbox isolation не реализована, injected dependencies — отдельная trust
boundary. Telegram отсутствует, OpenClaw/Codex route отсутствует и требует external verification,
OAuth отсутствует, API fallback disabled, production entrypoint отсутствует, persistent stores
отсутствуют. Package `exports` по-прежнему только root; host не публикуется.

**Build 3.1 implemented; pending Codex Review №6.** Pure local config bootstrap принимает только
explicit parsed object с четырьмя status-A секциями (modelRouting, memoryNamespaces,
memoryClassification, securityPolicy), переиспользует core parsers, fail-closed на unknown fields
и fallbacks, immutable snapshot; без file I/O, JSON text, env, credentials, provider activation.

**Build 3.2 storage boundary and schema contract implemented locally, pending independent
adversarial re-review and Codex Review №6.** Explicit lexical storage binding + schema version
contract only (`CURRENT_STORAGE_SCHEMA_VERSION` is the sole current-version source of truth);
filesystem не читается и не изменяется; backend unbound; durability none; writes/migrations/
encryption disabled; durable ports отсутствуют; SQLite/dependency decision и core transaction gap
отложены. Сервер/VPS не куплен. Deployment запрещён. Security approval отсутствует. Build №3
целиком не завершён.

Проверка ядра: `npm run check` с `OPENCLAW_PRODUCTION_NODE_GATE=1` — strict production Node gate
(override запрещён). Review/tooling runner может использовать `OPENCLAW_REVIEW_NODE_OVERRIDE=1`
только для локального tooling вне production gate; это не замена verified Node 22.13.0 PASS.
Публичные контракты экспортируются из `src/index.ts`.

Навигация: [архитектура](docs/architecture.md), [расширяемость](docs/extensibility.md),
[интеграции](docs/integrations.md), [VoiceProfile](docs/voice-profile.md),
[роли](docs/roles.md), [безопасность](docs/security-policy.md),
[критерии приёмки](docs/acceptance-criteria.md),
[совместимость OpenClaw](docs/openclaw-compatibility.md).
