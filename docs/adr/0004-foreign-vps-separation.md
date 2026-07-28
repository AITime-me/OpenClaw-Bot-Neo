# ADR 0004: Foreign VPS separation

## Status
Accepted — deployment validation required.
## Context
Помощник и российский production имеют разные trust и failure domains.
## Decision
Размещать помощника на отдельном зарубежном VPS TimeWeb Cloud; production не host. Разрешить только outbound A к allowlisted observed systems без reverse trust.
## Alternatives considered
Совместный production host; двусторонняя сеть; локальный workstation.
## Consequences
Отдельные расходы и operations, но лучшая изоляция.
## Security implications
Нет shared admin keys, inbound administration или общих backups; read-only credentials.
## Validation required
Threat model, firewall review, route test и доказательство отсутствия обратного доступа.
## Rollback or revision conditions
Остановить интеграции при нарушении изоляции; сменить host/network design.
