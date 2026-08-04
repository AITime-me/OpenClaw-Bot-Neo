# Будущие integrations

Build 3.5B adds connector platform contracts, SDK, in-memory registries, and an offline reference
connector only. Integrated into local `main` via fast-forward after feature-branch closeout;
approval clock corrective approved; no real adapter, OAuth, network call, production connector
wiring, or production Secret Provider is configured. No push performed. See
[connector platform](connector-platform.md) and
[closeout record](validation/build-3.5b-connector-platform-core-closeout.md).

Build 2.1B/2.1D/2.1E/2.1H содержат только provider-independent contracts и отключённые example
manifests. Реальных adapter, integration, webhook endpoint, cryptographic verifier и сетевого
вызова нет. Trusted derivation gateways принимают untrusted observations от будущих adapters и
создают sealed evidence только после exact validation. HTTP server и crypto provider не реализованы.

## Webhook boundary

Будущий ingress формирует `WebhookEnvelope` с source/event IDs, timestamps, payload digest,
signature metadata без signature value, idempotency key, content type/length, correlation ID и
privacy classification.

До обработки обязательны:

1. core copy caller bytes → canonical ownership;
2. source authentication;
3. signature verification на disposable copy → untrusted primitive result;
4. core binding checks (sourceId/digest/algorithm/keyReference) и sealing;
5. timestamp validation;
6. replay и duplicate-event protection;
7. idempotency;
8. payload size и rate limit;
9. media validation;
10. sensitive-data scan canonical bytes до memory/audit sinks.

Unknown source, invalid/stale timestamp, replay, duplicate event, oversized payload, failed,
malformed или unavailable verifier означают deny. Adapter не импортирует core sealer. Webhook
никогда не активирует extension.

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
