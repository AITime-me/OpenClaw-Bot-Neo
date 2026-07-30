# Архитектура

## Целевая модель

Гибридная архитектура разделяет заменяемый OpenClaw runtime и стабильное channel-agnostic ядро. Ядро содержит оркестрацию ролей, policy engine, risk routing и порты; адаптеры переводят внешние протоколы в общий контракт. Никакие channel-specific типы не проходят в core или будущие skills.

Фасады media, memory и scheduler скрывают реализации. Технология очереди намеренно не выбирается до исследования требований и возможностей установленной версии OpenClaw; тяжёлые задачи не должны блокировать основной message loop.

```mermaid
flowchart LR
  Owner[Владелец] --> TelegramAdapter
  FutureMobile[Future mobile] --> MobileAdapter

  subgraph BotVPS[Foreign TimeWeb Cloud Bot VPS]
    TelegramAdapter[Telegram adapter] --> Core[Stable channel-agnostic core]
    MobileAdapter[Mobile adapter] --> Core
    Core --> Policy[Policy and approvals]
    Core --> Roles[8 business role profiles]
    Core --> Runtime[Replaceable OpenClaw runtime]
    Core --> Media[Media facade]
    Core --> Memory[Memory facade]
    Core --> Scheduler[Scheduler facade]
    Runtime --> LLM[Subscription OAuth LLM]
  end

  BotVPS -->|A: outbound read-only| RussianProd[Russian production]
  BotVPS -->|outbound allowlisted| External[External systems]
```

## Границы доверия и серверов

Зарубежный VPS TimeWeb Cloud — **planned** хост помощника (не куплен, not deployed). Российский production-сервер не размещает помощника и не доверяет ему входящие команды. Поток A направлен только наружу от помощника к явно разрешённым наблюдаемым системам; reverse trust, общие административные учётные записи и обратные соединения запрещены.

По умолчанию компоненты слушают loopback. Межсерверный доступ требует отдельного allowlist, read-only credentials и минимального сетевого маршрута.

## Слои

1. Channel adapter: аутентификация интерфейса, нормализация сообщений, доставка уведомлений.
2. Core domain: типы, идентификаторы, доменные ошибки, operation context; не зависит ни от чего, кроме себя.
3. Core ports: контракты LLM, media, memory, scheduler, notifications, observed systems, approvals и `SensitiveDataScannerPort`; зависят только от domain.
4. Core policy и routing: детерминированные политики безопасности и risk routing; зависят только от domain и ports.
5. Core application: исполняемая оркестрация security-порядка, например memory-write boundary; зависит только от остальных core-слоёв.
6. App-private host (Build 3.0): локальный composition root вне core; собирает public core + ephemeral in-memory adapters; не публикуется через package exports; не создаёт trusted evidence.
7. Runtime adapter: заменяемая интеграция OpenClaw; все версии и поля сначала валидируются.
8. Infrastructure adapters: только после отдельного этапа Build.

Зависимости между слоями заданы allowlist-ом и проверяются структурным анализом AST (`npm run check:boundaries`), а не совпадением имён каталогов.

## Extension contracts

Core знает только декларативный `ExtensionManifest`, fixed security primitives и
`ExtensionRegistryPort`. Skill отвечает за capability/business analysis; channel или integration
отвечает за source authentication, protocol mapping и delivery. Ни одна сторона не наследует
полномочия другой.

Manifest не содержит code/import path и не является loader. Проверенный manifest замораживается,
затем доверенный application/deployment flow может передать его registry implementation вне core.
Фактические permissions — пересечение deployment, role, Security Guard и risk policy с deny
priority. Dynamic import из core запрещён checker независимо от target; computed
`import(expression)` / `require(expression)` также fail-closed.

Webhook contracts и VoiceProfile также provider-independent. Мужской профиль Нео не выбирает TTS
provider: если совместимого мужского голоса нет, применяется text-only, не женский fallback.

## Границы этапов

- Build №1 завершён: документы, ADR и нерабочие примеры JSON.
- Build №2 завершён: TypeScript domain, ports, детерминированные policy/routing, pipeline-контракты, draft skills и автоматические проверки без внешних соединений.
- Build 2.1A завершён: scoped/expiring/single-use approval, исполняемый memory-write boundary в `src/core/application/`, authenticated memory access context, усиленные scanner и URL policy, allowlist-based architecture checker. Это исправление Build №2, а не новый этап; adapters, providers, runtime и сеть по-прежнему отсутствуют.
- Build 2.1B добавляет только extensibility/registry/webhook/voice contracts, deterministic policies,
  отключённые example manifests и call-recording pipeline. Реального plugin loader, integration,
  webhook server, call service или TTS provider нет.
- Build 2.1C закрывает security findings OCN-001/002/003/006: approval binding к фактической
  memory operation и trusted clock, scanner newline/metadata-key policy, target-specific memory AST
  order и запрет computed module specifiers. B21-001—B21-004 намеренно не закрываются на этом этапе.
- Build 2.1D закрывает B21-001—B21-004: effective extension risk нельзя понизить runtime-параметром;
  dangerous permissions требуют matching approval effects; registry хранит activation state
  (`pending-policy` ≠ active); webhook authorization только через orchestration evidence;
  Neo VoiceProfile — только `ru-RU` masculine text-only fallback, disabled → text-only.
- Build 2.1E закрывает R2.1-003—R2.1-006: `RuntimeRiskEvidence` и `VerifiedVoiceProviderMatch`
  создаются только trusted classification/validation boundary; active registration — только после
  atomic registry transition; deployment authorization — sealed evidence, не boolean; webhook
  adapter возвращает untrusted verification result, canonical payload bytes принадлежат core,
  sealing signature evidence выполняет core. Ordinary object literals не являются trusted proof.
- Build 2.1F закрывает R2.1-001/002/007: metadata traversal budget (nodes/containers/key length/
  depth, check-before-descend); path-aware conservative memory checker (каждый write-reaching
  straight-line path; normalization и untrusted marking обязательны; ambiguous control flow →
  fail); VoiceProfile sealing через production SensitiveDataScanner. Не formal verification.
- Build 2.1G закрывает FIN-001/002/003: deeply immutable sanitized snapshot (один canonical snapshot
  для approval digest и MemoryPort); opaque `AuthenticatedMemoryAccessContext` через trusted
  `MemoryAccessGateway` (request body не назначает owner/actor/role); security evidence использует
  module-private WeakMap identity membership вместо transferable Symbol property. Package `exports`
  разрешает только root public API.
- Build 2.1H — FIN-004/005/006 **implemented, pending independent confirmation**:
  `ExtensionPermissionGateway`, `ExtensionActivationGateway` и `VoiceResolutionGateway`;
  uncertainty provider → text-only.
- Build 2.1I — FIN-007—FIN-014 **implemented, pending independent confirmation**: plain-JSON
  metadata DTO snapshot (descriptor-based; Proxy via `util.types.isProxy` only), path-valid
  approval CFG checker, webhook verifier single-read snapshot + distinct idempotency/replay
  outcomes, bounded token-family detectors, production config parsers, Node `>=22.13.0 <23`
  with documented review override, validated identity constructors, documentation truthfulness.
  FIN-012 later **CLOSED / VERIFIED** on real Node 22.13.0 (npm 10.9.2) with strict production
  gate and exact `@types/node@22.13.10` — without treating the project as production-ready.
- Build 2.1J-R4 — REV9-001: generator/async-generator executeMemoryWrite targets
  fail closed (`UNSUPPORTED_CONTROL_FLOW`) before body/stage accounting;
  **implemented, pending independent Codex Review №6**
- Build 2.1J-R3 — REV8-001/002: strict canonical AST allowlist
  (`UNSUPPORTED_CONTROL_FLOW` for labels/loops/switch/try/break/continue even without stages);
  approval-required condition AST-only (no getText security decision);
  **implemented, pending independent Codex Review №6**
- Build 2.1J-R2 — REV7-001/002/003: unreachable-after-return/throw fail-closed,
  naked approval outside gated AST sequence deny, security stages forbidden in
  expression containers; **implemented, pending independent Codex Review №6**
- Build 2.1J-R1 — CR5-001—CR5-008, REV6-001—REV6-010 и связанные
  FIN-002/004/006/008/009/011/013/014 **implemented, pending repeated independent pre-commit
  review and Codex Review №6**: recursive immutable authority/webhook snapshots, canonical
  AST-only memory-stage and approval data-flow checks, trusted-clock pre-write ordering,
  authorization-before-atomic-replay semantics, semantic exact schemas для всех status-C config
  families, scoped identity grammars и validated no-shell review runner. Это remediation Build №2,
  не начало Build №3.
- **Build 3.0 implementation revised after adversarial review; pending independent re-review and
  Codex Review №6.** App-private `src/host` local composition root (`createLocalHost`): in-memory
  ephemeral stores, deny-by-default memory policy, read/write authorization enforced through public
  `authorizeMemoryAccess`, credential-free, side-effect-free on import. Composition does not create
  built-in network clients; absolute network sandbox isolation is not enforced; injected
  dependencies remain a separate trust boundary. Trusted clock и authenticated access не inventятся
  host-ом. Telegram, OpenClaw/Codex route, OAuth, API fallback, production entrypoint и persistent
  stores отсутствуют. Package public API остаётся root-only.
- **Build 3.1 implemented; pending Codex Review №6.** Pure local config bootstrap
  (`parseLocalHostConfig` / `createLocalHostFromConfig`): explicit parsed-object envelope; four
  status-A families via existing core parsers; immutable snapshot; no file I/O, JSON text, env,
  credentials, or provider activation. Validated config is not authority evidence and does not wire
  runtime policy/routing.
- **Build 3.2 storage boundary and schema contract implemented locally, pending independent
  adversarial re-review and Codex Review №6.** App-private `parseStorageBindingRequest` /
  `createLocalStoragePlan` / `evaluateStorageSchemaCompatibility`: explicit platform + storageRoot
  only; lexical-only path validation via `node:path` (no cwd-dependent resolve, no fs probe; win32
  denies ADS colons and classic reserved device basenames); schema version compares observed values
  only to immutable `CURRENT_STORAGE_SCHEMA_VERSION` (no caller currentVersion override; with
  CURRENT=1, older valid versions do not yet exist); diagnostics report unbound backend, durability
  none, writes disabled, migrations/encryption absent. Lexical acceptance is not filesystem-open
  safety. LocalHost remains in-memory/ephemeral. Durable MemoryPort/ApprovalPort/audit,
  SQLite/dependency decision, and core transaction gap are out of scope. Build №3 целиком не
  завершён.
- Сервер не куплен. Deployment не разрешён.
- Реальный authentication/provider adapter и persistent atomic replay/idempotency store не
  реализованы. Окончательный security approval отсутствует pending Codex Review №6.
- Следующие slices Build №3 — только после independent review текущего storage slice.
- Только после security review: sandbox/integration environment.
- Production и deployment остаются отдельным решением.

Связанные документы: [расширяемость](extensibility.md), [интеграции](integrations.md),
[VoiceProfile](voice-profile.md), [каналы](channels.md), [безопасность](security-policy.md),
[deployment](deployment.md), [ADR runtime](adr/0001-openclaw-as-runtime.md).
