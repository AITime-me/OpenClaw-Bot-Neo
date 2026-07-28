# ADR 0001: OpenClaw as runtime

## Status
Proposed — runtime validation required.
## Context
Нужен оркестрационный runtime без привязки core к продукту или версии.
## Decision
Рассматривать OpenClaw как заменяемый runtime adapter; все его возможности UNVERIFIED до матрицы проверок.
## Alternatives considered
Собственный runtime; прямая зависимость core; другой framework.
## Consequences
Появляется adapter boundary и дополнительное тестирование, зато возможна замена.
## Security implications
Runtime не является policy boundary; approvals, scanner и deny rules остаются снаружи.
## Validation required
Закрепить версию и проверить config, OAuth, tools, memory, scheduler, channels, audit.
## Rollback or revision conditions
Заменить runtime при обходе policy, невозможности OAuth или неприемлемой изоляции.
