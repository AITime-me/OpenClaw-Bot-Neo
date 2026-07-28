# ADR 0003: Read-only-first

## Status
Accepted — enforcement validation required.
## Context
Помощник касается личных и operational данных с высокой ценой ошибки.
## Decision
Чтение и анализ — baseline; мутации, отправка, исполнение, удаление и публикация требуют scoped owner approval. Платежи запрещены.
## Alternatives considered
Автономные изменения; approval только для high-risk; dry-run по запросу.
## Consequences
Больше шагов, но владелец сохраняет контроль и audit trail.
## Security implications
Краткоживущий approval связан с intent, target и payload digest; deny-by-default.
## Validation required
Негативные тесты обхода, replay, scope escalation и stale approval.
## Rollback or revision conditions
Усилить до полностью read-only при любом bypass; ослабление только отдельным ADR.
