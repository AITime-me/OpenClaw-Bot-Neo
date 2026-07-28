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

## Owner approval

Approval является типизированным grant, а не булевым флагом и не свободной строкой. Grant связывает `ownerId`, `actorId`, effect, target, `payloadDigest`, `issuedAt`, `expiresAt`, `nonce` и одноразовое consumption state. Валидация детерминирована и не зависит от текста, созданного моделью.

Grant отклоняется, если не совпадает владелец, actor, effect, target, digest или nonce, если истёк срок, если timestamps некорректны, если grant отозван или уже использован, либо если effect неизвестен. Изменение payload меняет digest и делает grant недействительным. Consumption выполняется через `ApprovalPort` один раз; недоступность или сбой consumption означают отказ, а не продолжение. Payment-подобные effects отсутствуют в модели и не могут быть одобрены.

## Sensitive data scanning

`SensitiveDataScannerPort` определён в TypeScript-ядре, а минимальный детерминированный scanner реализует проверяемую базовую защиту. Порядок «scanner → policy → approval → sinks» реализован исполняемым memory-write сервисом в `src/core/application/` и проверяется структурно по AST, а не только описан в Markdown. Он обязан сканировать данные **до** памяти, логирования, внешнего вызова и audit-записи. TypeScript-типы не гарантируют, что секрет не оказался в обычной строке; runtime-проверка обязательна для каждого произвольного текста и сериализованного payload. Реализация Build №2 намеренно не заявляет полноту обнаружения и не заменяет vault или антивирус.

Минимальные классы обнаружения:

- API keys и bearer credentials;
- channel tokens, включая **Telegram bot tokens**;
- passwords и recovery codes;
- cookies и session material;
- private keys;
- URL credentials;
- database и service connection strings;
- произвольный текст, содержащий секретоподобные шаблоны или персональные данные.

Scanner возвращает только классификацию, диапазон, severity, безопасный masked preview и путь для metadata; исходное значение и его фрагменты в finding не попадают. Assignment покрывается целиком, включая quoted значения с пробелами; при неоднозначной границе выбирается более широкая redaction. Пересекающиеся диапазоны объединяются, повторная redaction идемпотентна. Неизвестная ошибка, превышение лимита размера или неоднозначный результат блокируют sink. Обход scanner запрещён даже для debug.

URL credentials определяются каноническим URL parsing, а не только regex: блокируется любой непустой userinfo, включая percent-encoded username, password и разделители. Private-key blocks и Telegram bot tokens никогда не достигают memory/logs. Scanner unavailable означает write denied. Metadata сканируется фактически: значение чувствительного по имени ключа редактируется целиком, вложенные структуры обходятся до документированных лимитов глубины и объёма.

Sanitized-значения представлены nominal-типами (`SanitizedText`, `SanitizedMetadata`, `VerifiedMemoryWrite`). Фабрики этих типов не входят в публичный API; доступ к ним ограничен allowlist-правилом architecture checker, поэтому adapter не может пометить непроверенную строку как sanitized. `MemoryPort.write` принимает только sealed write contract, а audit-порты — строго типизированные события без свободного payload.

## Недоверенный контент и память

Prompt injection рассматривается как данные, а не инструкция: внешний текст не может менять system policy, approvals, recipients, tool profile или trust classification. Memory poisoning сдерживается provenance, source trust, confidence, namespace isolation и запретом превращать неподтверждённый вывод в trusted fact. Любая попытка навязать bypass приводит к safe refusal без раскрытия внутренней политики или секрета.

## Сеть, файлы и media

- Текущая URL policy детерминирована и синтаксична: она отклоняет raw whitespace и control characters, malformed URL, неразрешённые схемы, любой userinfo, `localhost` во всех формах включая trailing dot, зарезервированные локальные суффиксы, loopback/private/link-local/metadata IPv4, IPv6 loopback, unspecified, ULA `fc00::/7`, link-local `fe80::/10`, multicast и IPv4-embedded IPv6. IP-диапазоны проверяются структурно через `node:net`, самодельный IPv6 parser не используется.
- Это **не** полная SSRF-защита. DNS resolution, проверка resolved IP, повторная проверка каждого redirect и защита от DNS rebinding остаются обязательными runtime gates будущего adapter и сейчас не реализованы.
- Path traversal блокирует absolute/parent/symlink escape и доступ вне назначенного local root.
- MIME spoofing проверяется content sniffing и allowlist; extension/header недостаточны.
- Decompression bombs ограничиваются compressed/uncompressed size, ratio, entry/page count, recursion depth и timeout.
- Quarantine используется до успешных scanner/MIME/size checks; cleanup и expiry обязательны.

## Tools и отказ

Tool profile ограничивает capability, target allowlist, read/write mode, duration, input/output size и concurrency. Elevated tools, privileged shell, unrestricted network и production admin credentials запрещены. Роль не может расширить собственный profile.

Safe refusal содержит класс блокировки, затронутую операцию и безопасный следующий шаг; не содержит raw payload, credential fragment, internal path или лишние персональные данные.

## Память и данные

Namespace изолирован по владельцу, роли и проекту; записи имеют source, observedAt, confidence, classification, retention и consent basis. Непроверенные выводы не становятся фактами. Embeddings по умолчанию отсутствуют; внешняя embedding-служба не разрешена. Retention применяется отдельно к сырью, derived notes и audit.

Каждая операция памяти — query, read, write, delete — требует authenticated access context с `ownerId`, `actorId`, ролью, активным namespace, project scope, correlation id и operation context с `AbortSignal` и timeout. Namespace, указанный только внутри переданной записи, не является авторизацией. Delete не принимает один идентификатор: запрос обязан включать ожидаемого владельца и ожидаемый namespace, поэтому знание record ID не даёт права на удаление. Проектный namespace не удаляет `personal` и `security-restricted`; `security-restricted` доступен только Security Guard внутри того же namespace; cross-project чтение требует явного permission, а cross-namespace мутация запрещена. Отсутствие любого обязательного элемента контекста означает deny.

## Runtime и supply chain

Версии runtime и адаптеров фиксируются после проверки; обновление контролируемое с review, тестом и rollback. OpenClaw-специфичные поля считаются UNVERIFIED до runtime validation. См. [совместимость](openclaw-compatibility.md) и [deployment](deployment.md).

## Architectural boundaries

Границы слоёв проверяются структурно: зависимости читаются из TypeScript AST, поэтому static import, `export ... from`, dynamic `import()` и `require()` распознаются одинаково. Каждый core-слой имеет allowlist разрешённых зависимостей; неизвестный каталог внутри `src`, внешний npm-пакет в core, цикл, sealed-модуль вне allowlist и отсутствие ожидаемого слоя или файлов считаются нарушением. Проверка не опирается на конкретные имена `adapters/providers/integrations/monitors`, поэтому переименование implementation layer не обходит правило.

Локальные проверки запускаются командой `npm run check`. Build 2.1A закрывает HIGH findings OCN-001—OCN-006 независимого review; эти gates действуют только внутри ядра и не означают, что OpenClaw runtime или adapters уже их используют.
