# Каналы

## Общий контракт

Channel adapter преобразует транспорт в:

```text
InboundEnvelope {
  channelKind, conversationRef, senderRef, receivedAt,
  text?, attachments[], locale?, replyTo?, idempotencyKey
}

OutboundEnvelope {
  conversationRef, content[], classification,
  notificationKind, correlationId, approvalRef?
}
```

Идентификаторы opaque и не используются как полномочия. Adapter отвечает за transport authentication, rate limits, replay protection, size validation, delivery receipts и redaction. Core отвечает за intent, роли, approval и policy. В core и будущих skills запрещены Telegram-типы, SDK-объекты, update/chat/message identifiers и transport-specific markup.

## Первая граница

Telegram планируется первым интерфейсом, но существует только на границе будущего адаптера. Bot token хранится вне репозитория, входящие данные недоверенные, webhook/polling и команды не считаются подтверждёнными до проверки runtime и threat model. Этот документ не создаёт бота или соединение.

Future mobile использует тот же контракт и не меняет core. См. [архитектуру](architecture.md).
