# ADR 0002: OpenAI subscription authentication

## Status
Proposed — runtime validation required.
## Context
Владелец требует subscription access без скрытого API billing.
## Decision
Default — ChatGPT Plus/Codex OAuth; API key и автоматический/платный fallback запрещены.
## Alternatives considered
API billing; multi-provider paid fallback; локальная модель.
## Consequences
При quota/auth failure сервис недоступен; расходы не возникают скрытно.
## Security implications
OAuth material хранится вне repo, минимально scoped и ротируется.
## Validation required
Подтвердить поддерживаемый flow и отсутствие API charges на закреплённой версии.
## Rollback or revision conditions
Отключить provider при неподтверждённой семантике; изменение требует нового ADR и owner consent.
