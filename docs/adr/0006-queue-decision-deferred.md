# ADR 0006: Queue decision deferred

## Status
Accepted — revisit after measurements.
## Context
На foundation-этапе нет подтверждённой нагрузки или delivery semantics.
## Decision
Не выбирать queue. Проектировать idempotent scheduler/dispatcher port и измерить потребность.
## Alternatives considered
Встроенная очередь сразу; managed broker; синхронный runtime как постоянное решение.
## Consequences
Меньше преждевременной infrastructure; будущая миграция предусмотрена контрактом.
## Security implications
Будущая очередь должна шифровать данные, ограничивать retention и не хранить secrets.
## Validation required
Собрать latency, retry, concurrency, durability и outage requirements.
## Rollback or revision conditions
Новый ADR при необходимости durable delivery, fan-out или независимого scaling.
