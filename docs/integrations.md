# Будущие integrations

Build 2.1B содержит только provider-independent contracts и отключённые example manifests. Реальных
adapter, integration, webhook endpoint и сетевого вызова нет.

## Webhook boundary

Будущий ingress формирует `WebhookEnvelope` с source/event IDs, timestamps, payload digest,
signature metadata без signature value, idempotency key, content type/length, correlation ID и
privacy classification.

До обработки обязательны:

1. source authentication;
2. signature verification;
3. timestamp validation;
4. replay и duplicate-event protection;
5. idempotency;
6. payload size и rate limit;
7. media validation;
8. sensitive-data scan до memory/audit sinks.

Unknown source, invalid/stale timestamp, replay, duplicate event, oversized payload, failed или
unavailable verifier означают deny. Webhook никогда не активирует extension.

## Будущий анализ звонков

Отключённые examples разделяют:

- `call-analysis` skill — получает уже авторизованный transcript и создаёт structured analysis;
- `external-call-service` integration — отвечает только за безопасный ingestion и provenance.

Возможные способы ingestion: authenticated webhook, API polling, signed file delivery или ручная
загрузка. Их реальная доступность должна быть проверена по документации сервиса перед отдельным
Integration Build.

«Мои звонки» — только возможный будущий пример. Не проверено, предоставляет ли этот сервис API,
webhooks или требуемые security guarantees; compatibility **UNVERIFIED**.

Будущий flow: external call service → source authentication → signature/timestamp/replay checks →
idempotency/limits → media validation → temporary encrypted storage → STT → call-analysis skill →
structured result → retention/cleanup.

Подробный lifecycle: [call-recording pipeline](../src/core/pipelines/call-recording.pipeline.md).
