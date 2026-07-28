# ADR 0009: Risk-based model routing

## Status
Proposed — provider/runtime validation required.
## Context
Задачи различаются по риску и capability, а model identifiers и доступность меняются.
## Decision
Маршрутизировать по risk/capability tiers без hardcoded models. High-risk требует stronger review/approval; failure не включает API или paid fallback.
## Alternatives considered
Одна модель; hardcoded model names; cost-first routing; автоматический paid fallback.
## Consequences
Предсказуемая policy и graceful unavailable, но требуется capability discovery.
## Security implications
Классификация и scanner до provider; high-risk context минимизируется и логируется безопасно.
## Validation required
Подтвердить доступные tiers, subscription semantics, failure paths и отсутствие billing fallback.
## Rollback or revision conditions
Перейти на один подтверждённый tier или отключить LLM при неоднозначном routing.
