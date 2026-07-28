# ADR 0008: Scheduling and financial alerts

## Status
Proposed — scheduler validation required.
## Context
Напоминания, подписки и quota/financial alerts требуют timezone, quiet hours и защиты от дублей.
## Decision
Использовать scheduler facade с idempotency, local timezone и notification policy. Финансовые события только наблюдаются; payment actions отсутствуют.
## Alternatives considered
Runtime-native scheduler; cron напрямую; ручные проверки.
## Consequences
Единые semantics и заменяемость; требуется persistent state после отдельного решения.
## Security implications
Минимизация сумм/получателей, redaction, approval на изменение правил, no payment tools.
## Validation required
DST/timezone, retry, missed run, duplicate, quiet-hour и quota fixture tests.
## Rollback or revision conditions
Отключить автоматическую доставку при дублях, неверном времени или раскрытии данных.
