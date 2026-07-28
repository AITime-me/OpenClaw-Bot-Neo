# ADR 0007: Memory isolation and provenance

## Status
Accepted — implementation validation required.
## Context
Личные, финансовые, юридические и operational данные нельзя смешивать.
## Decision
Изолировать память по owner/role/project namespace; хранить source, observedAt, confidence, classification и retention. Embeddings default none.
## Alternatives considered
Общая память; теги без enforcement; внешняя vector database по умолчанию.
## Consequences
Cross-role synthesis требует явного policy path; provenance остаётся проверяемым.
## Security implications
Scanner до записи, least access, deletion/retention и запрет secret storage.
## Validation required
Cross-namespace leakage tests, provenance integrity, retention and deletion tests.
## Rollback or revision conditions
Отключить persistent memory при утечке или невозможности гарантировать удаление.
