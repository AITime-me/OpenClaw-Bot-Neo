# Политика безопасности

## Базовые требования

- Один владелец, deny-by-default, least privilege, read-only-first.
- Внешние изменения, отправки, публикации, платежи, удаление, исполнение кода и повышение прав требуют явного, ограниченного по времени owner approval.
- Платёжные действия запрещены; помощник может только наблюдать и уведомлять.
- Получатели, источники, инструменты, namespaces и сетевые направления проверяются allowlist-политиками.
- Зарубежный VPS и российский production разделены; разрешён только outbound A к наблюдаемым системам, без reverse trust.
- Секреты хранятся вне репозитория; masking/redaction применяется до sinks; audit содержит решение policy и provenance, но не сырой секрет.
- Public sharing personal, private, confidential или security-restricted данных запрещён.
- Cross-border передача минимизируется по полям и объёму и требует явных policy purpose, allowlist и owner approval.
- Скрытый API fallback и paid fallback запрещены; provider failure означает unavailable.
- Ошибки авторизации, scanner или policy приводят к fail-closed отказу.

## Sensitive data scanning

`SensitiveDataScannerPort` определён в TypeScript-ядре, а минимальный детерминированный scanner реализует проверяемую базовую защиту. Он обязан сканировать данные **до** памяти, логирования, внешнего вызова и audit-записи. TypeScript-типы не гарантируют, что секрет не оказался в обычной строке; runtime-проверка обязательна для каждого произвольного текста и сериализованного payload. Реализация Build №2 намеренно не заявляет полноту обнаружения и не заменяет vault или антивирус.

Минимальные классы обнаружения:

- API keys и bearer credentials;
- channel tokens, включая **Telegram bot tokens**;
- passwords и recovery codes;
- cookies и session material;
- private keys;
- URL credentials;
- database и service connection strings;
- произвольный текст, содержащий секретоподобные шаблоны или персональные данные.

Scanner возвращает только классификацию, совпавшие классы и безопасную редактированную форму; не копирует найденное значение. Неизвестная ошибка, превышение лимита или неоднозначный результат блокируют sink. Обход scanner запрещён даже для debug.

URL credentials блокируются либо маскируются до отображения. Private-key blocks и Telegram bot tokens никогда не достигают memory/logs. Scanner unavailable означает write denied.

## Недоверенный контент и память

Prompt injection рассматривается как данные, а не инструкция: внешний текст не может менять system policy, approvals, recipients, tool profile или trust classification. Memory poisoning сдерживается provenance, source trust, confidence, namespace isolation и запретом превращать неподтверждённый вывод в trusted fact. Любая попытка навязать bypass приводит к safe refusal без раскрытия внутренней политики или секрета.

## Сеть, файлы и media

- SSRF guard блокирует loopback, private/link-local/internal targets, unsafe schemes, embedded URL credentials, DNS rebinding; каждый redirect проверяется заново.
- Path traversal блокирует absolute/parent/symlink escape и доступ вне назначенного local root.
- MIME spoofing проверяется content sniffing и allowlist; extension/header недостаточны.
- Decompression bombs ограничиваются compressed/uncompressed size, ratio, entry/page count, recursion depth и timeout.
- Quarantine используется до успешных scanner/MIME/size checks; cleanup и expiry обязательны.

## Tools и отказ

Tool profile ограничивает capability, target allowlist, read/write mode, duration, input/output size и concurrency. Elevated tools, privileged shell, unrestricted network и production admin credentials запрещены. Роль не может расширить собственный profile.

Safe refusal содержит класс блокировки, затронутую операцию и безопасный следующий шаг; не содержит raw payload, credential fragment, internal path или лишние персональные данные.

## Память и данные

Namespace изолирован по владельцу, роли и проекту; записи имеют source, observedAt, confidence, classification, retention и consent basis. Непроверенные выводы не становятся фактами. Embeddings по умолчанию отсутствуют; внешняя embedding-служба не разрешена. Retention применяется отдельно к сырью, derived notes и audit.

## Runtime и supply chain

Версии runtime и адаптеров фиксируются после проверки; обновление контролируемое с review, тестом и rollback. OpenClaw-специфичные поля считаются UNVERIFIED до runtime validation. См. [совместимость](openclaw-compatibility.md) и [deployment](deployment.md).

Локальные проверки Build №2 запускаются командой `npm run check`.
