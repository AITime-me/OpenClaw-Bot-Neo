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

Зарубежный VPS TimeWeb Cloud — отдельный хост помощника. Российский production-сервер не размещает помощника и не доверяет ему входящие команды. Поток A направлен только наружу от помощника к явно разрешённым наблюдаемым системам; reverse trust, общие административные учётные записи и обратные соединения запрещены.

По умолчанию компоненты слушают loopback. Межсерверный доступ требует отдельного allowlist, read-only credentials и минимального сетевого маршрута.

## Слои

1. Channel adapter: аутентификация интерфейса, нормализация сообщений, доставка уведомлений.
2. Core domain: типы, идентификаторы, доменные ошибки, operation context; не зависит ни от чего, кроме себя.
3. Core ports: контракты LLM, media, memory, scheduler, notifications, observed systems, approvals и `SensitiveDataScannerPort`; зависят только от domain.
4. Core policy и routing: детерминированные политики безопасности и risk routing; зависят только от domain и ports.
5. Core application: исполняемая оркестрация security-порядка, например memory-write boundary; зависит только от остальных core-слоёв.
6. Runtime adapter: заменяемая интеграция OpenClaw; все версии и поля сначала валидируются.
7. Infrastructure adapters: только после отдельного этапа Build.

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
- Следующий этап: локальные адаптеры и runtime policy enforcement после отдельного утверждения.
- Только после security review: sandbox/integration environment.
- Production и deployment остаются отдельным решением.

Связанные документы: [расширяемость](extensibility.md), [интеграции](integrations.md),
[VoiceProfile](voice-profile.md), [каналы](channels.md), [безопасность](security-policy.md),
[deployment](deployment.md), [ADR runtime](adr/0001-openclaw-as-runtime.md).
