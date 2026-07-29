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

Approval является типизированным grant, а не булевым флагом и не свободной строкой. Grant связывает
`ownerId`, `actorId`, effect, target, namespace, project scope, `payloadDigest`, `issuedAt`,
`expiresAt`, `nonce` и одноразовое consumption state. Валидация детерминирована и не зависит от
текста, созданного моделью.

Для memory-write caller передаёт только `approvalId` (или его отсутствие). Approval demand строится
внутри trusted application boundary из фактической операции: authenticated owner/actor, effect,
namespace, project scope, operation target, record id и canonical digest sanitized content/metadata.
Caller не передаёт готовый demand, digest или время проверки. Один trusted timestamp берётся из
`ClockPort` на всю операцию; expiry сверяется с ним, а не с caller-supplied `now`.

Grant отклоняется при несовпадении владельца, actor, effect, target, namespace, project scope или
digest, при истечении срока, некорректных timestamps, отзыве, повторном использовании, malformed
state или неизвестном effect. Изменение content или metadata после выдачи grant меняет digest и
делает grant недействительным. Consumption выполняется через `ApprovalPort` атомарно: два
параллельных consume не могут оба завершиться успехом. Это требование контракта порта, а не
реализованное transactional storage в этом репозитории. Недоступность или сбой consumption означают
отказ до MemoryPort write. Payment-подобные effects отсутствуют в модели и не могут быть одобрены.

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

Scanner возвращает только классификацию, диапазон, severity и безопасный masked preview; исходное
значение, фрагменты секрета и raw metadata path в finding не попадают. Assignment покрывается
целиком, включая quoted значения с пробелами и один допустимый перевод строки (LF/CRLF) между
separator и value. Пустой range после separator и неоднозначная multiline-конструкция (несколько
последовательных переносов) завершаются fail-closed deny, а не allow. Пересекающиеся диапазоны
объединяются, повторная redaction идемпотентна. Неизвестная ошибка, превышение лимита размера или
неоднозначный результат блокируют sink. Обход scanner запрещён даже для debug.

URL credentials определяются каноническим URL parsing, а не только regex: блокируется любой непустой
userinfo, включая percent-encoded username, password и разделители. Private-key blocks и Telegram
bot tokens никогда не достигают memory/logs. Scanner unavailable означает write denied. Metadata
сканируется на каждом уровне вложенности: и keys, и values. Unsafe metadata key (secret-like имя,
control/newline или secret-shaped содержимое) → deny всей операции; ключ не попадает в MemoryPort,
audit, errors или finding в исходном виде. Metadata имеет единый bounded traversal budget: каждый
посещённый descendant node (leaf или container, включая пустые объекты/массивы), суммарная длина
key names и глубина. Лимит проверяется до обработки следующего узла; ровно на лимите — допуск,
следующий узел — deny. Cyclic, Date/Map/Set/typed array/class instance и throwing getter/proxy →
deny без утечки key/value. Findings/errors не содержат raw key names или secret fragments. Safe
audit использует `metadataFieldCount` и категории findings, а не raw `Object.keys()`
пользовательской metadata.

Sanitized-значения представлены opaque evidence-типами (`SanitizedText`, `SanitizedMetadata`,
`VerifiedMemoryWrite`). Фабрики не входят в публичный API; доступ ограничен allowlist architecture
checker. Trust — module-private WeakMap membership по object identity, а не TypeScript brand и не
Symbol property: spread/`Object.assign`/prototype/`structuredClone`/JSON clone не являются evidence.
Sanitized snapshot defensive-copied и deeply frozen; один и тот же canonical snapshot используется
для approval digest, policy и `MemoryPort.write`. Retained scanner references не могут изменить
write после sealing. Audit принимает только sealed write contract без свободного payload и без
mutable metadata.

## Недоверенный контент и память

Prompt injection рассматривается как данные, а не инструкция: внешний текст не может менять system policy, approvals, recipients, tool profile или trust classification. Memory poisoning сдерживается provenance, source trust, confidence, namespace isolation и запретом превращать неподтверждённый вывод в trusted fact. Любая попытка навязать bypass приводит к safe refusal без раскрытия внутренней политики или секрета.

## Сеть, файлы и media

- Текущая URL policy детерминирована и синтаксична: она отклоняет raw whitespace и control characters, malformed URL, неразрешённые схемы, любой userinfo, `localhost` во всех формах включая trailing dot, зарезервированные локальные суффиксы, loopback/private/link-local/metadata IPv4, IPv6 loopback, unspecified, ULA `fc00::/7`, link-local `fe80::/10`, multicast и IPv4-embedded IPv6. IP-диапазоны проверяются структурно через `node:net`, самодельный IPv6 parser не используется.
- Это **не** полная SSRF-защита. DNS resolution, проверка resolved IP, повторная проверка каждого redirect и защита от DNS rebinding остаются обязательными runtime gates будущего adapter и сейчас не реализованы.
- Path/symlink-root isolation — **planned/contract-only, not implemented**. Будущий file adapter
  обязан блокировать absolute/parent/symlink escape и доступ вне назначенного local root.
- MIME content sniffing/allowlist — **planned/contract-only, not implemented**; extension/header
  сами по себе недостаточны.
- Decompression-bomb limits — **planned/contract-only, not implemented**: обязательны bounds для
  compressed/uncompressed size, ratio, entry/page count, recursion depth и timeout.
- Quarantine, cleanup и expiry — **planned/contract-only, not implemented** до появления media
  adapters.

## Tools и отказ

Tool profile ограничивает capability, target allowlist, read/write mode, duration, input/output size и concurrency. Elevated tools, privileged shell, unrestricted network и production admin credentials запрещены. Роль не может расширить собственный profile.

Safe refusal содержит класс блокировки, затронутую операцию и безопасный следующий шаг; не содержит raw payload, credential fragment, internal path или лишние персональные данные.

## Extensions и permissions

Manifest является декларацией, не кодом и не источником доверия. Неизвестные schema/kind/field,
permission, port, risk class или extension запрещены. Manifest не содержит import path, shell
command или secret value и после валидации глубоко замораживается.

`manifest.enabled` означает только право рассматривать extension для регистрации. Enabled
manifest регистрируется как `pending-policy`; disabled — как `disabled`. Permissions выдаются
только sealed `active` evidence. Pending/disabled/rejected — deny.

Requested permission — запрос. Итог — пересечение manifest request, deployment, role, Security Guard
и risk policy. Effective risk = max(immutable manifest risk, active registration
`effectiveRiskClass`, sealed `RuntimeRiskEvidence.classifiedRisk`, trusted routing/source floor,
Security Guard floor и operation category). Trust facts и grant arrays поступают только из
pre-bound `ExtensionPermissionGateway` dependencies, не из request. Caller-controlled
`sourceTrust`/`securityGuardFloor`/`policyVersion`/grant arrays/`now` удалены как proof.
Missing/stale/mismatched evidence → deny. Deny приоритетнее allow; Director не обходит Security
Guard; модель не меняет permissions или risk. Dangerous permissions требуют matching approval
effects и явного deployment grant. Active registration создаётся только trusted registry
transition через `ExtensionActivationGateway`; deployment authorization требует authenticated
deployment/owner observation, policy-controlled TTL и trusted clock; публичный issuer из caller
strings отсутствует. Canonical manifest digest охватывает полный policy-sensitive manifest;
returned registry entry сверяется полностью.

## Webhook ingress

Authorization формируется только `executeWebhookIngress`: exact immutable command/signature
snapshot → canonical payload digest → length-framed canonical signed representation → full
signed-envelope digest → immutable verifier request → exact verifier-result snapshot → полная
binding envelope version/source/event/timestamp/idempotency/nonce/payload/signature material/
algorithm/key reference → rate limit → scanner → policy authorization → atomic replay/idempotency
check-and-record → sealed evidence → safe audit.
Ordinary boolean state не является proof. Caller и adapters получают только immutable records или
disposable byte copies; повторного чтения raw command после snapshot нет. Audit содержит только
безопасные identifiers/digest prefix, без raw payload/signature/secrets. `REPLAY_DETECTED` и
`DUPLICATE_IDEMPOTENCY_KEY` различаются. Persistent atomic replay/idempotency store —
**contract-only/not implemented** и обязателен до deployment. Pre-authorization deny не занимает
replay/idempotency key; после успешного atomic check-and-record последующий dispatch/audit failure
не освобождает key и безопасный retry получает duplicate/replay outcome.

## Voice safety

VoiceProfile provider-independent. Для Нео обязательны `ru-RU`, masculine, `fallbackMode:
text-only`, запрет cross-gender/cloning/imitation и контролируемые style tags. Disabled Neo и
отсутствие sealed `VerifiedVoiceProviderMatch` всегда дают text-only; feminine fallback запрещён.
Adapter возвращает untrusted observation; trusted `VoiceResolutionGateway` сверяет facts с
trusted provider configuration и current voice policy. Favorable booleans
(`metadataVerified`/`compatibleWithSelector`/`clonedVoice: false`) и caller time/policy/TTL не
являются proof. Ordinary favorable object literal не разрешает voice. Uncertainty, mismatch и
unavailable observation → text-only. До sealing все текстовые поля профиля проходят production
SensitiveDataScanner; scanner failure/limit/sensitive → deny без утечки secret fragments.

## Память и данные

Namespace изолирован по владельцу, роли и проекту; записи имеют source, observedAt, confidence, classification, retention и consent basis. Непроверенные выводы не становятся фактами. Embeddings по умолчанию отсутствуют; внешняя embedding-служба не разрешена. Retention применяется отдельно к сырью, derived notes и audit.

Каждая операция памяти — query, read, write, delete — требует opaque
`AuthenticatedMemoryAccessContext`, создаваемый только trusted composition
(`MemoryAccessGateway` + pre-bound authentication dependency). Ordinary `MemoryAccessContext`
object literal, frozen clone, TypeScript cast и request body поля `owner`/`actor`/`role`/
`authenticated: true` не являются authorization. Role `security-guard` не может быть
self-asserted. Знание record ID не даёт read/delete. Namespace, указанный только внутри переданной
записи, не является авторизацией. Проектный namespace не удаляет `personal` и `security-restricted`;
`security-restricted` доступен только Security Guard внутри того же namespace; cross-project чтение
требует явного permission, а cross-namespace мутация запрещена. Реальный Telegram/OpenClaw
authentication adapter ещё не реализован.

Security evidence (runtime risk, registry activation, deployment authorization, webhook, voice,
sanitized memory, authenticated access) использует identity-based private WeakMap membership.
Symbol properties, spread clones и prototype clones не являются proof.

## Runtime и supply chain

Версии runtime и адаптеров фиксируются после проверки; обновление контролируемое с review, тестом и rollback. OpenClaw-специфичные поля считаются UNVERIFIED до runtime validation. См. [совместимость](openclaw-compatibility.md) и [deployment](deployment.md).

## Architectural boundaries

Границы слоёв проверяются структурно: зависимости читаются из TypeScript AST, поэтому static import,
`export ... from`, dynamic `import()` и `require()` распознаются одинаково. Non-literal
(computed) module specifier в `import(expression)` или `require(expression)` — fail-closed
нарушение `COMPUTED_MODULE_SPECIFIER`; checker не пытается вычислить expression. Каждый core-слой
имеет allowlist разрешённых зависимостей; неизвестный каталог внутри `src`, внешний npm-пакет в
core, цикл, sealed-модуль вне allowlist и отсутствие ожидаемого слоя или файлов считаются
нарушением. Проверка не опирается на конкретные имена
`adapters/providers/integrations/monitors`, поэтому переименование implementation layer не обходит
правило. Boundary checker запрещает computed imports в repository source, но не является runtime
sandbox.

Memory AST checker (`verify-memory-isolation.mjs`) анализирует тело `executeMemoryWrite`
path-aware / conservative: обязательный порядок включает context validation, input normalization,
untrusted marking, scanner, authorization, policy, approval demand/validation/consume, write и
safe audit. Разрешена только canonical AST grammar (statements/if/return/throw/block и
canonical approval gate). Labels, loops, switch, try/catch/finally, break/continue и прочий
unsupported control-flow → `UNSUPPORTED_CONTROL_FLOW` даже без security stages. Stages/write
внутри split if/else (кроме early deny и approval gate), callbacks или logical/conditional
expressions → fail. Dead helper и другая функция не засчитываются. Сохранение, destructuring,
binding, passing, returning, wrapping, optional/computed access, `.bind`, `.call` и `.apply` для
security-stage functions запрещены; разрешён только canonical direct call. Условие
approval-required доказывается AST-only (property chain + string literal), без getText в
security decision. Checker не является formal verification или полноценным interprocedural proof;
сложная неоднозначная структура отклоняется. Runtime correctness по-прежнему требует tests и review.

Локальные проверки запускаются командой `npm run check`. Build 2.1A закрыл первичные HIGH findings
независимого review. Build 2.1B добавил fail-closed extension, permission, webhook и voice
contracts без loader или integrations. Build 2.1C закрывает OCN-001 (approval binding), OCN-002
(scanner newline/metadata keys), OCN-003 (target-specific memory AST) и OCN-006 (computed
import/require). Build 2.1D закрывает B21-001—B21-004. Build 2.1E закрывает R2.1-003—R2.1-006
(trusted evidence closure). Build 2.1F закрывает MEDIUM R2.1-001/002/007. Build 2.1G закрывает
FIN-001/002/003 (immutable sanitized snapshot, authenticated memory gateway, non-forgeable WeakMap
provenance, restrictive package exports). Build 2.1H — FIN-004/005/006 implemented, pending
independent confirmation. Build 2.1I — FIN-007—FIN-014 implemented, pending independent
confirmation (metadata DTO boundary, approval CFG, webhook snapshot/idempotency, token families,
config parsers, Node contract, identity constructors, docs truthfulness). Build 2.1J-R4 closes
REV9-001 (generator executeMemoryWrite target allowlist gap) —
**implemented, pending independent Codex Review №6**. Build 2.1J-R3 closes
REV8-001/002 (unsupported control-flow allowlist; AST-only approval-required condition) —
**implemented, pending independent Codex Review №6**. Build 2.1J-R2 closes
REV7-001/002 (unreachable stage credit; naked approval without gated AST data-flow) and applies
REV7-003 expression-container policy for security stages — **implemented, pending independent
Codex Review №6**. Build 2.1J-R1 remediation
CR5-001—CR5-008, REV6-001—REV6-010 и связанных FIN-002/004/006/008/009/011/013/014
**implemented, pending repeated independent pre-commit review and Codex Review №6**. Status-C
drafts проверяются semantic exact schemas, а не равенством одному example. FIN-012 остаётся
**PARTIALLY CLOSED / BLOCKED**. Окончательный security approval отсутствует pending Review №6.
Build №3 не начат; VPS не куплен; deployment
не разрешён. Эти gates действуют только внутри ядра и не означают, что OpenClaw runtime или
adapters уже их используют.
