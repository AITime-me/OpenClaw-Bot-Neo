# Каналы

## Статус

**Verified fact:** в репозитории есть тонкие channel-agnostic типы (`IncomingMessage` /
`OutgoingMessage`) и порт `ChannelPort`. Исполняемого Telegram/mobile adapter, communication
ingress loop и trusted channel envelope **нет**.

**Build 3.7A (design-only):** целевая модель текстового vertical slice зафиксирована в
[docs/communication/](communication/text-architecture.md). Реализация отсутствует.

**Build 3.7B (contracts only):** package-private offline contracts в `src/core/communication/`.
Исполняемый runtime, Telegram-адаптер и durable stores отсутствуют. Build 3.7B next stage: 3.7C.
Build 3.7E1 status: BLOCKED. Build 3.7F status: BLOCKED.
См. [3.7B closeout](validation/build-3.7b-communication-contracts-closeout.md).

## Целевой контракт (Build 3.7A)

Transport adapter (временный Telegram **или** будущий private mobile messenger) остаётся
app-private и после структурного parsing передаёт в core только
**validated-but-untrusted** channel-independent observation:

```text
TransportTextObservation {
  transportInstanceRef,   // untrusted / opaque
  externalMessageRef,     // untrusted
  externalConversationRef,// untrusted
  externalSenderRef,      // untrusted
  sourceTimestamp?,       // untrusted metadata only — NOT ordering authority
  text                    // bounded raw text
}
```

Raw SDK DTO (Telegram update и т.п.) не покидает adapter.

Trusted local boundary (не adapter) выполняет нормативный admission order:

```text
NORMATIVE_ADMISSION_ORDER:
sealed transport validation
→ atomic observed admission
→ duplicate stop
→ owner binding
→ authenticated
→ accepted + conversationSequence
```

Trusted boundary назначает `TurnId`, `CommunicationIdempotencyKey`, `observedAt`, canonical
`ConversationId`, `CorrelationId` и `conversationSequence`. Transport **не** задаёт trusted
`OwnerId`, `ActorId`, authority, canonical conversation/session/turn ids, correlation/idempotency
keys или `observedAt`. Source timestamp не определяет порядок.

Opaque capabilities после binding:

- `AuthenticatedCommunicationPrincipal` — communication authority;
- отдельно авторизованный read-only `AuthenticatedMemoryAccess` — memory authority.

Обычный object literal не является authenticated evidence. См.
[text-architecture](communication/text-architecture.md) и
[trust model](communication/text-trust-and-threat-model.md).

Legacy doc names `InboundEnvelope` / `OutboundEnvelope` **не** являются реализованными TS-типами и
не должны читаться как уже существующий trusted channel contract.

## Временный Telegram / конечный mobile

Telegram — только временный app-private transport adapter. Конечный интерфейс — собственное
мобильное приложение / закрытый мессенджер владельца с Neo. Communication core не зависит от
Telegram и должен позволять замену adapter без переписывания conversation state, semantic memory,
LLM routing, orchestration и security policy.

Bot token хранится вне репозитория. Webhook/polling и команды не считаются подтверждёнными до
будущей реализации, threat-model controls и encryption live gate для persisted conversational
content. Этот документ не создаёт бота или соединение.

См. [архитектуру](architecture.md), [Build 3.7A closeout](validation/build-3.7a-text-communication-design-closeout.md).
