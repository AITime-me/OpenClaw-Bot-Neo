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
drafts проверяются semantic exact schemas, а не равенством одному example. FIN-012 —
**CLOSED / VERIFIED** на реальном Node 22.13.0 (npm 10.9.2) со strict
`OPENCLAW_PRODUCTION_NODE_GATE=1`, без review override, и exact pin `@types/node@22.13.10`.
Окончательный security approval отсутствует pending Review №6.
**Build 3.0** (revised after adversarial review) добавляет app-private `src/host` composition вне
core: host не inventит authenticated context, trusted clock evidence, approval validation evidence
или иные sealed values; clock inject-ится явно; memory policy по умолчанию deny-by-default; read/
write/query/delete в in-memory adapter fail-closed через публичный `authorizeMemoryAccess`;
in-memory approval seed хранит только plain `ApprovalGrant` (не sealed evidence и не issuer);
composition не создаёт built-in network clients, но абсолютная network sandbox isolation не
заявляется. Core не зависит от host; host не импортирует `*.internal` sealers.
**Build 3.1** добавляет pure local config bootstrap: только explicit parsed object, четыре
status-A секции через существующие core parsers, fail-closed unknown fields / fallbacks, immutable
snapshot; без file I/O, JSON text, env, credentials, SecretRef, provider activation. Validated
config не является authority evidence и не включает runtime wiring.
**Build 3.2** добавляет app-private storage boundary & schema contract: explicit `platform` +
`storageRoot` binding request, lexical-only path policy (без fs/stat/realpath/mkdir; win32 fail-closed
для ADS colon и classic reserved device names), pure schema compatibility только против immutable
`CURRENT_STORAGE_SCHEMA_VERSION` (caller currentVersion override отсутствует; migration не
выполняется и при CURRENT=1 не достижима валидной older version), immutable unbound storage plan.
Filesystem в 3.2 не читается и не изменяется; storage backend unbound; durability none; writes
disabled; encryption absent; lexical accept ≠ filesystem-open-safe.
**Build 3.3A** exact-pin'ит `better-sqlite3@12.11.1` / `@types/better-sqlite3@7.6.13` без adapter.
**Build 3.3B1** добавляет app-private POSIX/Linux safe-open существующего storage root
(`openPosixStorageRoot` + explicit policy): runtime-verified Linux platform (binding `posix` alone
недостаточен), symlink-component walk, ownership/mode policy без авто-chmod/chown/mkdir, repository
containment через explicit trusted `repositoryRoot`, directory handle lifecycle, honest diagnostics
(`filesystemProbed=true`, `storageBackend=unbound`, `databaseOpened=false`, `writesEnabled=false`,
`durability=none`, `storageLock=none`, `deploymentReady=false`, `toctouFullyEliminated=false`,
`privilegedAttackerResistant=false`). Exclusive multi-process lock отложен. Не открывает SQLite, не
создаёт database, не делает MemoryPort durable, не проверен в Ubuntu container, не является
deployment/security approval. Durable MemoryPort/ApprovalPort/audit отсутствуют; core transaction
gap остаётся; secret-provider pending. Storage input — constructor/binding input будущего adapter,
не секция Build 3.1 config envelope. Build №3 целиком не завершён; planned VPS Timeweb Cloud
(4 vCPU / 8 ГБ / 80 ГБ NVMe, Ubuntu 24.04, Linux server-only) не куплен; Windows agent runtime
запрещён; deployment не разрешён. Эти gates действуют внутри ядра/host и не означают,
что OpenClaw runtime или channel adapters уже их используют.

**Cleanup ownership (3.3B1 remediation):** после успешного `openSync`/`openDirectory` ровно один
владелец владеет ресурсом. Pre-transfer dual failure (например fstat errno + close errno) до
создания opaque handle возвращает явный cleanup lifecycle (`CLOSE_FAILED` /
`STORAGE_ROOT_CLOSE_FAILED` + `pendingCleanup.retryClose`) — не обычный IO failure при открытом fd.
Programmer error + close failure пробрасывается как `PosixStorageRootOwnershipError` с тем же
opaque lifecycle и original error (не ordinary StorageFailure). На downstream validation failure
close вызывается ровно один раз; при успешном cleanup возвращается исходная validation failure; при
неуспешном cleanup — `STORAGE_ROOT_CLOSE_FAILED` с обязательным `pendingCleanup`. Composition,
получившая lifecycle, обязана вызвать `retryClose` до success; после успеха повтор idempotent.
Lifecycle не зависит от GC/`FinalizationRegistry`, не является exclusive storage lock и не
second-instance protection. Ubuntu container validation по-прежнему pending.

**Build 3.3B2A (prerequisite):** `MemoryQueryRequest` требует explicit `limit` (1..100; константы
`MEMORY_QUERY_LIMIT_MIN` / `MEMORY_QUERY_LIMIT_MAX`); default отсутствует; неверный limit →
`VALIDATION_FAILED` без coercion/clamping. In-memory и будущий SQLite MemoryPort обязаны соблюдать
одинаковый ceiling. Поле `query` по-прежнему не является поиском по содержимому; offset/cursor/
pagination отсутствуют. LocalHost остаётся in-memory; Linux validation и Codex Review №6 pending;
production readiness не заявлена. (SQLite adapter реализован отдельно в Build 3.3B2 и не wired.)

**Build 3.3B2B (prerequisite):** successful B1 `OpenedPosixStorageRoot` проверяется по runtime
object identity (module-private WeakMap), а не по structural typing. Structural clone, freeze,
spread/`Object.assign`, JSON roundtrip, Proxy wrapper, getter fake, brand string/symbol и
изготовленный вручную объект не являются capability и не выдают trusted storage root path.
Capability действует только пока root в состоянии `open`; `root.close` при нуле child leases
навсегда запрещает новых consumers (state `retired`/`closed`); failed close не реактивирует
capability. При активных same-process SQLite leases `root.close` возвращает busy и оставляет
capability полностью open (Build 3.3B3A). Это не secret, не credential, не filesystem/exclusive/
process lock и не second-instance protection; несколько low-level adapters на одном open root
по-прежнему разрешены. Resolve facade — exact SQLite factory; lease facade — exact SQLite factory
и exact process-lock factory (не package/host barrel export; sealer API этим factories не
получают). Lease сам по себе не process lock.

**Build 3.3B2:** app-private `createSqliteMemoryPort` открывает compile-time `neo-memory.sqlite`
только внутри genuine open safe-root capability; raw path/filename/env/cwd/home запрещены.
Schema v1; empty bootstrap; verify-only reopen; no destructive migration/reset. Pragmas:
foreign_keys ON, bounded busy_timeout, WAL, synchronous NORMAL, trusted_schema OFF (если
поддерживается); startup `quick_check`. MemoryPort semantic parity с in-memory (auth, limit 1..100,
owner/namespace predicates, ordinal-preserving overwrite, delete+reinsert new ordinal). Owner
является частью storage identity `(ownerId, namespace, recordId)` для in-memory и SQLite.
Isolation через UNIQUE(owner_id, namespace, record_id). Explicit connection close; close-failure
оставляет state `close-pending` (операции запрещены; retry deterministic; never returns to open;
lease удерживается до successful DB close). Diagnostics: `storageBackend=sqlite`,
`memoryPortDurability=sqlite-local`, `localHostWired=false`, approval/audit не durable,
`crossPortAtomicity=false`, encryption/lock/second-instance/Linux container/deploymentReady=false,
`storageRootLeaseCoordinated=true` (same-process only). Secrets/OAuth/tokens в memory запрещены
политикой записи. LocalHost остаётся in-memory и не wired. Ubuntu container validation и Codex
Review №6 pending; production/VPS/deployment запрещены. Не заявляется absolute security
boundary против произвольного кода уже внутри trusted host process.

**Build 3.3B3A:** root↔SQLite adapter lease coordination в одном процессе: factory приобретает
lease до открытия DB; `root.close` fail-closed busy при active/close-pending adapters без retire
capability и без directory teardown; successful adapter close освобождает lease; failed close и
bootstrap pendingCleanup удерживают lease. Не process lock / flock / PID file.

**Build 3.3B3B2 / B3B3B3 / B3B4-F1 / B3B5:** exact pin `fs-ext-extra-prebuilt@2.2.10`; app-private
Linux-only `acquirePosixProcessLock` на fixed placeholder `neo.primary.lock` (не SQLite DB/WAL/SHM,
не PID file). Open: `O_RDWR|O_CREAT|O_NOFOLLOW` mode `0600` — Node v22.13.0 не экспортирует
`fs.constants.O_CLOEXEC`; Linux libuv атомарно выставляет CLOEXEC внутри `open` (implementation
evidence). Production fail-closed проверяет фактический `FD_CLOEXEC` через native
`fcntlSync(fd, "getfd")` после open (Candidate C committed). `setfd` и magic numeric `O_CLOEXEC` не
используются. Original B3B4 Linux gate FAILED; runtime research probe passed; full repeated B3B4
PASSED (`BUILD_3_3B3B4_LINUX_PRIMITIVE_GATE_PASSED`) на Ubuntu 24.04.4 LTS / linux-amd64 /
glibc 2.39 / Docker overlayfs / Node v22.13.0 (default production acquire, getfd/FD_CLOEXEC,
same/separate-process contention, normal + SIGKILL release, unsafe-file rejection, redaction,
no unlink/stale deletion). Build 3.3B3B5 записывает
`linuxIntegrationValidatedForPrimitive=true` только как evidence disposable gate на pinned target —
не означает NFS/CIFS (`distributedFilesystemSupported=false`), LocalHost/Neo wiring, systemd или
deployment readiness. Kernel flock exclusive nonblocking; close fd освобождает lock; root child
lease удерживается пока fd open/release-pending; placeholder может остаться после crash и никогда
не unlink для stale recovery. Cooperative second acquire → `STORAGE_LOCK_HELD`. Primitive **не**
wired к LocalHost/Neo и не участвует в Neo startup lifecycle;
`secondInstanceProtectionActiveForNeo=false`; systemd layer отсутствует. Advisory only:
non-cooperating process может обойти; нет privileged-attacker / path-replacement resistance; не
absolute OS mutex и не global single-writer для всех SQLite clients.

**Build 3.3B3C1:** app-private pure durable owner/controller с operation gate и ordered retryable
non-reentrant shutdown на snapshotted injected fake closures only. Не открывает POSIX root /
process lock / SQLite; не делает MemoryPort durable; не wired к LocalHost production bootstrap;
diagnostics оставляют real-wiring flags false. Pure controller тестируется на Windows.
Codex Review №6 pending; deployment запрещён.

**Build 3.3B3C2:** app-private Linux-gated POSIX durable composition (`createPosixDurableLocalHost`)
wire'ит real POSIX root → exclusive process lock → SQLite MemoryPort **внутри factory only**,
переиспользует B3C1 owner, выполняет deterministic startup rollback (SQLite → lock → root).
Existing `createLocalHost()` остаётся in-memory. Factory не package/host-exported; не подключена к
Neo startup; B3B3/B3B5 process-lock primitive сам по себе остаётся unwired к Neo. Build 3.3B3C4-FINAL
records authoritative complete durable-composition Linux integration validation
(`linuxIntegrationValidatedForCompleteDurableComposition=true`) on validated source
`5f3b3862dea078613e0aacba3834efbbbfe9376e` and immutable image
`sha256:cc961fff5f5defc144eab8a540500ae43b68cb58ffdbf2d42c3a2b0fd6fbc834`; scenarios A–K PASS;
evidence hashes 19/19. systemd pending; durable Approval/Audit absent; secret
provider/encryption absent. Codex Review №6 pending; deployment запрещён.

**Build 3.3B3C3:** defensive hardening перед B3C4 — malformed closer/cleanup validation,
startup cleanup reentrancy safety, frozen terminal failures, exact dynamic-import target allowlist
для composition factory. Build 3.3B3C4-FINAL records authoritative Linux validation in diagnostics
only; deployment/security approval unchanged. Codex Review №6 pending; deployment запрещён.

**Codex Review №6 — finding registry (partial):**

- **R6-H01 (HIGH, lifecycle → readiness/status): CLOSED.** Cooperative shutdown could recreate
  readiness after shutdown latch during in-flight publication. Remediation commit
  `6b89e7a2d3be072328828bb465b66a937a48349e` adds post-publication `lifetime.isRequested()`
  recheck, suppresses `neo.runtime.ready`, and reconciles readiness without duplicate shutdown.
  Closure evidence: deterministic race suite (20 passed), independent source review
  (`R6_H01_INDEPENDENT_REVIEW_APPROVED_WITH_NOTES_FOR_LINUX_REGRESSION`), and non-authoritative
  disposable Linux L1–L5 regression (manifest 31/31). See
  [closeout record](validation/codex-review-6-r6-h01-readiness-race-closeout.md).
- **R6-H02 (HIGH, memory → durable persistence): CLOSED.** Scanner-unknown secret-class material
  could reach durable memory when an injected product allow-policy returned allow. Remediation
  commits `e385d66af93b889f2b9424a4ed85d326c875c4e4` and corrective
  `21a637fd619fd1c1e3de496e508ce9a4b673b9ff` enforce non-overrideable secret-class/provenance
  boundary, bound single-use clearance, narrow sink verifier, and native SQLite pre-transaction
  rejection. Closure evidence: independent re-review
  (`R6_H02_INDEPENDENT_REREVIEW_APPROVED_FOR_SECURITY_FINDING_CLOSEOUT`), P1–P18 PASS,
  **1519 passed** / 3 skipped, aggregate check PASS. Scanner remains defense-in-depth; universal
  free-text secret detection is not claimed. See
  [closeout record](validation/codex-review-6-r6-h02-durable-memory-secret-boundary-closeout.md).
- **R6-M01 (MEDIUM, lifecycle → durable owner cleanup): CLOSED.** Fatal close failure previously
  discarded the retryable durable owner via `markFailed()`, allowing false successful retry and
  dishonest `neo.runtime.stopped`. Remediation commit
  `c73aaecd7e8e00e4f0a2ecfc64141063cabaeaf3` retains the unresolved owner while lifecycle remains
  terminally `failed`, retries the same owner, and clears ownership only after confirmed cleanup
  success. Closure evidence: independent review
  (`APPROVE_WITH_NOTES_R6_M01_FOR_SECURITY_FINDING_CLOSEOUT` /
  `R6_M01_INDEPENDENT_REVIEW_APPROVED_WITH_NOTES_FOR_SECURITY_FINDING_CLOSEOUT`), O1–O15 PASS,
  **1537 passed** / 3 skipped, aggregate check PASS, **NO_LINUX_RERUN_REQUIRED**. See
  [closeout record](validation/codex-review-6-r6-m01-retryable-durable-owner-closeout.md).
- **R6-M02 (MEDIUM, production Node gate in launcher): CLOSED.** Remediation commit
  `6427a34b07ef9a4b031cafa9737d660a2fc265b4` enforces `>=22.13.0 <23` via dependency-free
  `scripts/lib/node-version-contract.mjs` before any Neo runtime import; unsupported runtime
  exits **3**; systemd `RestartPreventExitStatus=10 3` suppresses restart on exit **3**;
  `scripts/neo/neo-status.mjs` remains intentionally ungated; direct compiled CLI is unsupported.
  Closure evidence: independent source review
  (`APPROVE_WITH_NOTES_R6_M02_SOURCE_FOR_FOCUSED_SYSTEMD_REGRESSION` /
  `R6_M02_INDEPENDENT_SOURCE_REVIEW_APPROVED_WITH_NOTES_FOR_FOCUSED_SYSTEMD_REGRESSION`), N1–N15
  PASS, focused disposable systemd regression (supported PASS; unsupported exit **3** non-restart
  PASS after harness correction), **1571 passed** / 3 skipped at source review, aggregate check PASS,
  **FULL_LINUX_L1_L5_NOT_REQUIRED**. Disposable systemd proof is non-authoritative broad validation.
  See
  [closeout record](validation/codex-review-6-r6-m02-production-node-gate-systemd-closeout.md).
- **R6-M03 (MEDIUM, readiness/status → live process identity): CLOSED.**
  Readiness schema **v2** binds `ready.json` to Linux boot ID and process start-time ticks; status
  verifies the exact live process instance at read time and rejects stale, legacy schema v1,
  reused-PID, boot-mismatched, and zombie records. Status remains read-only and does not acquire
  the process lock. Raw `ready.json` must not be treated as liveness proof — use
  `scripts/neo/neo-status.mjs`. Initial independent source review blocked the implementation
  (`R6_M03_INDEPENDENT_SOURCE_REVIEW_BLOCKED`); corrective re-review approved with notes
  (`R6_M03_CORRECTIVE_SOURCE_REREVIEW_APPROVED_WITH_NOTES_FOR_FOCUSED_LINUX_REGRESSION`); P1–P18
  PASS; focused disposable Linux procfs regression PASS (manifest 93/93). **R6-M03 is closed for
  live process identity-bound readiness.** `securityApprovalComplete=false`, `deploymentReady=false`.
  See [closeout record](validation/codex-review-6-r6-m03-live-process-identity-closeout.md).
- **R6-L01—R6-L04 (LOW hardening package): CLOSED.** Descriptor-safe config read (`O_RDONLY |
  O_NOFOLLOW` authority), exclusive/no-follow readiness temp publication, exact correlated
  integration evidence, and owner-only runtime/durable state permissions (`umask 0077`). Remediation
  commit `486403811250651e0e547237c2acdc5be29ee63b`; TC01 corrective
  `5aef38a9b989198e37d51f5a237e74cb4378e714`; fixture corrective
  `6309432d06a8db2bce463a5cf87f865470af7aae`. Initial source review
  `BLOCK_R6_LOW_HARDENING_SOURCE` (R6-L-TC01 only); corrective re-review
  `APPROVE_R6_LOW_HARDENING_CORRECTIVE_SOURCE_FOR_FOCUSED_LINUX_FILESYSTEM_REGRESSION`; focused
  disposable Linux filesystem regression PASS (manifest 87/87). Package disposition:
  `R6_LOW_HARDENING_PACKAGE_CLOSED_WITH_DESCRIPTOR_SAFE_CONFIG_EXCLUSIVE_READINESS_CORRELATED_EVIDENCE_AND_OWNER_ONLY_STATE`.
  Encryption remains `false` and deferred; systemd hardening remains deferred. Online
  dependency/provenance review remains open. See
  [closeout record](validation/codex-review-6-r6-low-hardening-package-closeout.md).

Codex Review №6 as a whole remains **blocked**. `securityApprovalComplete` and `deploymentReady`
remain false. Production/VPS/connectors remain prohibited.

## Connector platform (Build 3.5B)

Tool invocation uses separate tool-scoped ports (`ToolPolicyEngine`, `ToolApprovalPort`,
`ToolApprovalDecisionPort`, `ToolAuditPort`, `ConnectorSecretProvider`) and does not replace memory
approval/audit/secret contracts. Pending approval is not executable; trusted grant/deny/revoke is
required before single-use consumption. Secret handles resolve only after policy allow and approval
consumption. Connector output is always untrusted. `FINANCIAL` side-effect tools are rejected at
manifest validation and hard-denied by default policy. Read-only financial analysis remains
representable as `READ_ONLY`. Build 3.5B integrated into local `main` after security corrective
re-review and approval clock corrective; dispositions:
`BUILD_3_5B_CONNECTOR_PLATFORM_CORE_CLOSED_WITH_TRUSTED_APPROVAL_PRIVATE_EXECUTION_BOUNDED_DATA_AND_SAFE_INVOCATION_PIPELINE`;
`BUILD_3_5B_APPROVAL_CLOCK_CORRECTIVE_CLOSED_WITH_SINGLE_INJECTED_TIME_DOMAIN`. In-memory approval
ports require an injected `ClockPort`; grant and consume evaluate expiry in the same clock domain.
No production Secret Provider is configured (`SECRET_PROVIDER_CONFIGURED=false`). Durable
approval/audit persistence absent. `securityApprovalComplete` and `deploymentReady` remain false.
No push performed. See [closeout record](validation/build-3.5b-connector-platform-core-closeout.md).

## Infrastructure platform (Build 3.6B)

Infrastructure inventories are metadata-only and cannot execute operations. Infrastructure tools reuse
the Build 3.5B invocation pipeline exclusively. Provider/host/log output is untrusted. Server deletion,
financial provider actions, firewall mutation and credential rotation are hard-denied in foundation
policy. Reference infrastructure adapters are test-only. No Timeweb network client or SSH
implementation. `SECRET_PROVIDER_CONFIGURED=false`. `deploymentReady` remains false. Pending
independent review on feature branch `build-3-6b-infrastructure-fleet-foundation`. See
[infrastructure platform](infrastructure-platform.md).
