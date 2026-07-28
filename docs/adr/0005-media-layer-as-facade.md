# ADR 0005: Media layer as facade

## Status
Proposed — capability validation required.
## Context
Media providers, formats, privacy and limits меняются независимо от ролей.
## Decision
Ввести channel-neutral media facade; multimodal workflow является capability, не ролью. Local-first, paid disabled.
## Alternatives considered
Provider calls из roles; один универсальный LLM; отдельная девятая роль.
## Consequences
Больше контрактов, но смена provider не затрагивает core.
## Security implications
Scanner, classification, size/type limits и approval применяются до внешней обработки.
## Validation required
Fixture tests для metadata, limits, redaction, unavailable и no-paid routes.
## Rollback or revision conditions
Отключить capability при утечке, неконтролируемой оплате или недостоверных limits.
