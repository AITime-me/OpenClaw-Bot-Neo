# OpenClaw Bot Neo

Архитектурный фундамент личного помощника владельца. Это не клиентский бот и не публичный сервис.

## Целевой продукт

Помощник объединяет ровно восемь бизнес-ролей:

1. AI Director / AI-директор над проектами.
2. Tech Watchdog / Технический сторож.
3. Integration Engineer.
4. Business Analyst / Бизнес-аналитик.
5. Marketing Strategist / Маркетинговый стратег.
6. AI Scout / парсер возможностей.
7. Personal Assistant / Личный ассистент.
8. Security Guard.

Multimodal workflow — общая техническая capability обработки текста, изображений, аудио и документов, а не девятая роль.

Первый интерфейс — Telegram через изолированный адаптер; в будущем возможен мобильный клиент. Стабильное ядро не зависит от канала.

## Принципы

- read-only-first; любое изменение внешней системы требует явного одобрения владельца;
- зарубежный VPS TimeWeb Cloud — **planned** хост помощника (не куплен, not deployed), отдельно от российского production-сервера;
- доверие одностороннее: помощник наблюдает разрешённые системы, обратного доверия к нему нет;
- основной доступ к LLM — ChatGPT Plus/Codex OAuth; автоматического перехода на API-биллинг нет;
- платные fallback-провайдеры выключены;
- секреты, персональные данные и неподтверждённые сведения не попадают в репозиторий.

## Статус

**Build №2 + Security Remediation 2.1A–2.1J-R4: implemented contracts and pure core logic;
not deployed; pending independent Codex Review №6.**

**Build 3.0 (Host Boundary and Local Composition Root): implemented; adversarial review APPROVE;
pending Codex Review №6.** App-private `src/host` composition; in-memory ephemeral stores;
deny-by-default memory policy; read/write authorization enforced; composition creates no built-in
network clients; absolute network sandbox isolation is not enforced.

**Build 3.1 implemented; pending Codex Review №6.** Pure local config bootstrap
(`parseLocalHostConfig` / `createLocalHostFromConfig`): explicit parsed-object envelope only;
four status-A families via existing core parsers; immutable snapshot; no file I/O, JSON text, env,
credentials, provider activation, OpenClaw/Telegram/OAuth, production entrypoint, or persistent
storage.

**Build 3.2 storage boundary and schema contract implemented locally, pending independent
adversarial re-review and Codex Review №6.** App-private pure storage binding request,
lexical-only explicit path policy (win32 denies ADS colons and classic reserved device names),
schema-version compatibility against immutable `CURRENT_STORAGE_SCHEMA_VERSION` only (no caller
currentVersion override), and immutable unbound storage plan. Filesystem is not read or modified;
storage backend remains unbound; durability none; writes disabled; migrations disabled; encryption
absent. No durable ApprovalPort/audit and no core transaction boundary in Build 3.2; the later
Build 3.3B2 app-private SQLite MemoryPort is separate and remains unwired to LocalHost.
Storage input is constructor/binding input for a future adapter — not part of the Build 3.1 config
envelope and not a claim that a disk schema exists or that a lexical path is filesystem-open-safe.

**Build 3.3A / 3.3B1 / 3.3B2A / 3.3B2B / 3.3B2 / 3.3B3A / 3.3B3B2 / 3.3B3B3 / 3.3B3B4-F1 / 3.3B3B5 (partial Build 3.3):**
SQLite dependencies exact-pinned (`better-sqlite3@12.11.1`, `@types/better-sqlite3@7.6.13`). Process
lock dependency exact-pinned (`fs-ext-extra-prebuilt@2.2.10`). POSIX/Linux safe-open for an
already-existing storage root (`openPosixStorageRoot`) is implemented with honest diagnostics.
Build 3.3B2A requires `MemoryQueryRequest.limit` (1..100). Build 3.3B2B seals genuine open roots as
identity capabilities. Build 3.3B2 adds an app-private SQLite MemoryPort adapter that opens
`neo-memory.sqlite` only inside a genuine open safe-root capability (no raw path, no env/cwd/home,
no LocalHost wiring). Build 3.3B3A coordinates same-process root↔adapter leases: `root.close()` is
fail-closed busy while any SQLite adapter holds an open or close-pending connection; busy close does
not retire the capability; successful adapter close releases the lease. Build 3.3B3B3 adds an
app-private Linux-only exclusive process-lock primitive on fixed placeholder `neo.primary.lock`
(kernel flock, close-fd release, root child lease while fd open); cooperative second-instance
contention fails closed. The original Build 3.3B3B4 Linux gate **FAILED** because production open
required caller-visible `fs.constants.O_CLOEXEC`, which is `undefined` on Node v22.13.0 / Linux
(libuv 1.49.2 still sets `O_CLOEXEC` atomically inside `open` as implementation evidence). Build
3.3B3B4-F1 remediates Candidate C: open uses only `O_RDWR|O_CREAT|O_NOFOLLOW` mode `0600`, then
fail-closed post-open `getfd`/`FD_CLOEXEC` verification via the pinned native package (no production
`setfd`, no magic numeric `O_CLOEXEC`). Runtime research probe passed; Candidate C was committed;
the full repeated Build 3.3B3B4 Linux gate then **PASSED**
(`BUILD_3_3B3B4_LINUX_PRIMITIVE_GATE_PASSED`) on Ubuntu 24.04.4 LTS / linux-amd64 / glibc 2.39 /
Docker overlayfs / Node v22.13.0 / npm 10.9.2 (default production acquire, getfd/FD_CLOEXEC,
same/separate-process contention, normal + SIGKILL release, unsafe-file rejection, redaction,
no unlink/stale deletion, no setfd). Build 3.3B3B5 records
`linuxIntegrationValidatedForPrimitive=true` as pinned-target evidence only. The primitive is
**not** wired to LocalHost/Neo — Neo second-instance protection remains inactive. Placeholder may
remain after crash; never unlinked for stale recovery. Advisory/cooperative only —
non-cooperating processes can bypass; no privileged-attacker / NFS / path-replacement resistance;
overlayfs gate does not prove NFS/CIFS (`distributedFilesystemSupported=false`). It does not make
ApprovalPort/AuditPort durable, does not provide cross-port transactions, encryption, secret
storage, TOCTOU elimination, or deployment approval. At B3B5 time LocalHost still remained
in-memory and unwired to SQLite/process-lock. systemd absent. Codex Review №6 pending. Planned VPS:
Timeweb Cloud 4 vCPU / 8 ГБ / 80 ГБ NVMe, Ubuntu 24.04, Linux server-only; no Windows agent runtime.

**Build 3.3B3C1:** app-private pure durable owner/controller (`createDurableLocalHostOwner`) with
operation gate and ordered retryable non-reentrant shutdown over snapshotted injected fake
resource closures only. Not a real root/lock/SQLite composition; not package-exported;
Windows-testable pure lifecycle only. Deployment prohibited.

**Build 3.3B3C2:** app-private Linux-gated POSIX durable composition factory
(`createPosixDurableLocalHost`) wires real POSIX root → exclusive process lock → SQLite MemoryPort,
reuses B3C1 owner/controller, and returns frozen `{ host, diagnostics, close }` only after full
startup success. Startup rollback is deterministic (SQLite → lock → root). Existing
`createLocalHost()` remains in-memory. Factory is not package/host-exported; not connected to Neo
startup; complete B3C4 Linux integration validation recorded (see Build 3.3B3C4-FINAL); systemd pending; durable Approval/Audit
absent; secret provider/encryption absent. Codex Review №6 pending. Deployment prohibited.

**Build 3.3B3C3:** defensive hardening before B3C4 Linux integration gate — malformed closer/cleanup
result validation, startup cleanup reentrancy safety, terminal failure freezing, exact dynamic-import
target allowlist for the composition factory. Does not wire durable composition to Neo startup;
process-lock primitive itself remains unwired to Neo (B3B5); `createLocalHost()` remains in-memory.
Deployment prohibited.

**Build 3.3B3C4-FINAL:** independent evidence review APPROVE. Authoritative offline durable-composition
Linux gate PASS (`BUILD_3_3B3C4_LINUX_COMPOSITION_GATE_PASSED`) on validated source
`5f3b3862dea078613e0aacba3834efbbbfe9376e`, immutable runtime image
`sha256:cc961fff5f5defc144eab8a540500ae43b68cb58ffdbf2d42c3a2b0fd6fbc834`, scenarios A–K PASS,
evidence hashes 19/19, Ubuntu 24.04.4 / Node 22.13.0 / npm 10.9.2. Records
`linuxIntegrationValidatedForCompleteDurableComposition=true` in composition diagnostics only.
`deploymentReady` and security approval remain false. Deployment prohibited.

**Build 3.4H (closeout):** independent evidence review
`BUILD_3_4G_INDEPENDENT_REVIEW_APPROVED_WITH_NOTES_FOR_CLOSEOUT`. Disposable Linux Neo runtime
L1–L5 (`BUILD_3_4_LINUX_NEO_RUNTIME_GATE_PASSED`, STAB10 manifest 36/36) and disposable systemd
S1–S7 (`BUILD_3_4F_NEO_SYSTEMD_LINUX_VALIDATION_PASSED`) on validated source
`4096a87586475aacb01dc27596c1e1dd494f9778`, package-lock
`f8b9ce9fdbf3dd1d69f219df2a997e58b1cd5abcb077312b5151ba729175db54`, bundle
`c067aa98c9f4e1fa927ec2dbab9a461d43ccda94c332b67eb734f198cb28a69b`, offline image
`sha256:cc961fff5f5defc144eab8a540500ae43b68cb58ffdbf2d42c3a2b0fd6fbc834` (image label
non-authoritative). Records `processLockWiredToNeo=true`,
`neoSecondInstanceProtectionActive=true`, and `systemdLayerConfigured=true` only. Production
deployment not performed; VPS not used; connectors/channels/credentials not enabled;
`deploymentReady`, security approval, secret provider, encryption, and durable Approval/Audit remain
false. See [Build 3.4 validation record](docs/validation/build-3.4-neo-linux-systemd-validation.md).
Deployment prohibited.

| Слой | Статус |
|------|--------|
| Target architecture | planned |
| Pure core policies / contracts | implemented |
| Trusted composition gateways | implemented |
| App-private local host composition (Build 3.0) | implemented (ephemeral / non-durable) |
| Pure local config bootstrap (Build 3.1) | implemented (parsed-object only) |
| Storage boundary & schema contract (Build 3.2) | implemented (lexical / unbound / no I/O) |
| SQLite dependency gate (Build 3.3A) | pinned |
| POSIX safe storage root (Build 3.3B1) | implemented (open existing root only) |
| Bounded MemoryQuery limit (Build 3.3B2A) | implemented (required limit 1..100) |
| Safe-root capability seal (Build 3.3B2B) | implemented (identity capability) |
| SQLite MemoryPort adapter (Build 3.3B2) | implemented (app-private; LocalHost unwired) |
| Root↔adapter lease coordination (Build 3.3B3A) | implemented (same-process; not a process lock) |
| Process lock dependency pin (Build 3.3B3B2) | pinned (`fs-ext-extra-prebuilt@2.2.10`) |
| App-private exclusive process lock (Build 3.3B3B3) | implemented (primitive only; LocalHost/Neo unwired) |
| Linux CLOEXEC runtime remediation (Build 3.3B3B4-F1) | implemented (Candidate C committed) |
| Linux process-lock primitive validation (Build 3.3B3B4/B3B5) | recorded (`linuxIntegrationValidatedForPrimitive=true`; primitive unwired to Neo) |
| Durable owner/controller fake lifecycle (Build 3.3B3C1) | implemented (app-private; fake closures only) |
| POSIX durable LocalHost composition (Build 3.3B3C2) | implemented (app-private; wires root/lock/SQLite inside factory only; Neo unwired; B3C4 Linux validation recorded) |
| Durable composition hardening (Build 3.3B3C3) | implemented (malformed-result guards; cleanup reentrancy; exact dynamic-import allowlist) |
| Complete durable composition Linux validation (Build 3.3B3C4-FINAL) | recorded (`linuxIntegrationValidatedForCompleteDurableComposition=true`; authoritative A–K PASS; not deployment approval) |
| Neo runtime/process foundation (Build 3.4) | implemented (compiled launcher, readiness, signals, production composition) |
| Disposable Neo Linux runtime validation (Build 3.4E-STAB10) | recorded (L1–L5 PASS; process lock + second-instance wiring evidenced) |
| Disposable Neo systemd validation (Build 3.4F) | recorded (S1–S7 PASS; `systemdLayerConfigured=true`; not production-installed) |
| Build 3.4 closeout (Build 3.4H) | recorded (see `docs/validation/build-3.4-neo-linux-systemd-validation.md`) |
| Codex Review №6 R6-H01 readiness race (closeout) | closed for cooperative shutdown/readiness ordering (see `docs/validation/codex-review-6-r6-h01-readiness-race-closeout.md`) |
| Codex Review №6 R6-H02 secret boundary (closeout) | closed for bounded secret-provenance durable-memory guarantee (see `docs/validation/codex-review-6-r6-h02-durable-memory-secret-boundary-closeout.md`) |
| Codex Review №6 R6-M01 durable owner (closeout) | closed for retryable durable-owner preservation after fatal close failure (see `docs/validation/codex-review-6-r6-m01-retryable-durable-owner-closeout.md`) |
| Codex Review №6 R6-M02 Node gate (closeout) | closed for mandatory pre-import Node gate and systemd exit-3 non-restart proof (see `docs/validation/codex-review-6-r6-m02-production-node-gate-systemd-closeout.md`) |
| Codex Review №6 R6-M03 live process identity (closeout) | closed for live process identity-bound readiness on supported Linux procfs (see `docs/validation/codex-review-6-r6-m03-live-process-identity-closeout.md`) |
| Telegram / OpenClaw adapters | not implemented |
| OpenClaw runtime | not implemented |
| VPS / deployment | not purchased / not deployed |
| Security approval | absent pending independent Codex Review №6 (R6-H01, R6-H02, R6-M01, R6-M02, R6-M03 closed; R6-L01 next) |

**Codex Review №6 R6-H01 (closeout):** readiness shutdown/publication race remediated at
`6b89e7a2d3be072328828bb465b66a937a48349e`. Closure evidence: deterministic race suite (20 passed),
independent source review (`R6_H01_INDEPENDENT_REVIEW_APPROVED_WITH_NOTES_FOR_LINUX_REGRESSION`),
and non-authoritative disposable Linux L1–L5 regression (`BUILD_3_4_LINUX_NEO_RUNTIME_GATE_PASSED`,
manifest 31/31). **R6-H01 is closed for cooperative shutdown/readiness-publication ordering.**

**Codex Review №6 R6-H02 (closeout):** durable-memory secret boundary remediated at
`e385d66af93b889f2b9424a4ed85d326c875c4e4` with corrective `21a637fd619fd1c1e3de496e508ce9a4b673b9ff`.
Closure evidence: independent re-review
(`R6_H02_INDEPENDENT_REREVIEW_APPROVED_FOR_SECURITY_FINDING_CLOSEOUT`), P1–P18 PASS, **1519 passed**
/ 3 skipped, aggregate check PASS, **NO_LINUX_RERUN_REQUIRED**. **R6-H02 is closed for the bounded
secret-provenance guarantee.** Scanner remains defense-in-depth; universal free-text secret detection
is not claimed.

**Codex Review №6 R6-M01 (closeout):** fatal close owner-loss remediated at
`c73aaecd7e8e00e4f0a2ecfc64141063cabaeaf3`. Closure evidence: independent review
(`APPROVE_WITH_NOTES_R6_M01_FOR_SECURITY_FINDING_CLOSEOUT` /
`R6_M01_INDEPENDENT_REVIEW_APPROVED_WITH_NOTES_FOR_SECURITY_FINDING_CLOSEOUT`), O1–O15 PASS,
**1537 passed** / 3 skipped, aggregate check PASS, **NO_LINUX_RERUN_REQUIRED**. **R6-M01 is closed
for retryable durable-owner preservation after fatal close failure.**

**Codex Review №6 R6-M02 (closeout):** production Node gate remediated at
`6427a34b07ef9a4b031cafa9737d660a2fc265b4`. Closure evidence: independent source review
(`R6_M02_INDEPENDENT_SOURCE_REVIEW_APPROVED_WITH_NOTES_FOR_FOCUSED_SYSTEMD_REGRESSION`), N1–N15
PASS, focused disposable systemd regression (supported PASS; unsupported exit **3** non-restart
PASS), **FULL_LINUX_L1_L5_NOT_REQUIRED**. **R6-M02 is closed for mandatory pre-import Node gate and
systemd exit-3 non-restart proof.** Disposable systemd proof is non-authoritative broad validation.

**Codex Review №6 R6-M03 (closeout):** live process identity-bound readiness remediated at
`eee734a2e4d4a5e0689c2e039dfa04d18e4d8880` with corrective `7a1fbbd52b3ad4145955139c469c2e31fa4660f5`.
Closure evidence: initial source review blocked (`R6_M03_INDEPENDENT_SOURCE_REVIEW_BLOCKED`);
corrective re-review (`R6_M03_CORRECTIVE_SOURCE_REREVIEW_APPROVED_WITH_NOTES_FOR_FOCUSED_LINUX_REGRESSION`);
P1–P18 PASS; focused disposable Linux procfs regression PASS (manifest 93/93);
**FULL_LINUX_L1_L5_NOT_REQUIRED**. **R6-M03 is closed for live process identity-bound readiness.**
Disposable Linux proof is non-authoritative broad validation.

Codex Review №6 overall remains blocked; next finding is **R6-L01**. `deploymentReady` and
`securityApprovalComplete` remain false. See
[R6-M03 closeout record](docs/validation/codex-review-6-r6-m03-live-process-identity-closeout.md).

Build 2.1B добавляет versioned declarative manifests, default-deny permission composition,
provider-independent registry/webhook contracts, отключённые examples для call-analysis и external
call service, а также мужской VoiceProfile Нео. Manifest не является кодом и не выдаёт полномочия;
подходящий мужской голос недоступен — используется text-only, без женского fallback.

Build 2.1C–2.1F: contract hardening (approval binding, sealed evidence, metadata budgets,
path-aware memory checker). Implemented in core; pending independent confirmation where noted.

Build 2.1G — FIN-001/002/003 foundations implemented: immutable sanitized
snapshot, opaque `AuthenticatedMemoryAccessContext` через trusted `MemoryAccessGateway`,
WeakMap/WeakSet identity membership. Package `exports` — только root API.

Build 2.1H — FIN-004/005/006 foundations implemented: trust/risk/policy
и deployment/voice derive через pre-bound gateways.

Build 2.1J-R4 — точечное закрытие REV9-001 (generator executeMemoryWrite target)
**implemented, pending independent Codex Review №6**. Recognized `function*` /
`async function*` targets fail closed as `UNSUPPORTED_CONTROL_FLOW` before stage accounting.

Build 2.1J-R3 — финальное ужесточение memory isolation checker по REV8-001/REV8-002
**implemented, pending independent Codex Review №6**. Target-specific AST allowlist:
labels/loops/switch/try/break/continue → `UNSUPPORTED_CONTROL_FLOW` даже без stages;
approval-required condition — только AST (без getText в security decision).

Build 2.1J-R2 — корректирующий проход по REV7-001/REV7-002 (и REV7-003 expression-container
policy) **implemented, pending independent Codex Review №6**. Memory checker fail-closed на
unreachable stages после return/throw и на naked approval lookup/validate/consume вне canonical
gated AST sequence; security stages нельзя скрывать в object/array/ternary/logical containers.

Build 2.1J-R1 — корректирующий проход по CR5-001—CR5-008, REV6-001—REV6-010 и связанным
FIN-002/004/006/008/009/011/013/014 **implemented, pending independent Codex Review №6**. Реализованы full-envelope webhook binding и recursive immutable snapshots,
authorization-before-replay ordering, AST-only approval/clock/memory-stage checks, semantic exact
schemas для всех status-C families, runtime identity parsers и quality-check spawning без shell.
Windows npm fallback допускается только после realpath-привязки к фактической Node/npm installation
и является исключительно local review tooling, а не production runtime path.

FIN-012 **CLOSED / VERIFIED**: production runtime contract `Node >=22.13.0 <23` подтверждён на
реальном Node **22.13.0** (npm **10.9.2**) со strict gate `OPENCLAW_PRODUCTION_NODE_GATE=1` и без
`OPENCLAW_REVIEW_NODE_OVERRIDE`. Typings: exact pin `@types/node@22.13.10` (undici-types 6.20.0).
Полный suite на этом runtime: 21 files / 547 tests PASS; boundaries/secrets/hygiene PASS.
Закрытие FIN-012 не означает production-ready проект.
Build 2.1J-R4 не является security-approved (Codex Review №6 pending).

**Build 3.0 implementation revised after adversarial review; pending independent re-review and
Codex Review №6.** Появился app-private слой `src/host` с local-only composition root
(`createLocalHost`): in-memory ephemeral stores, deny-by-default memory policy, read/write
authorization via public `authorizeMemoryAccess`, composition не создаёт built-in network clients,
абсолютная network sandbox isolation не реализована, injected dependencies — отдельная trust
boundary. Telegram отсутствует, OpenClaw/Codex route отсутствует и требует external verification,
OAuth отсутствует, API fallback disabled, production entrypoint отсутствует, persistent stores
отсутствуют. Package `exports` по-прежнему только root; host не публикуется.

**Build 3.1 implemented; pending Codex Review №6.** Pure local config bootstrap принимает только
explicit parsed object с четырьмя status-A секциями (modelRouting, memoryNamespaces,
memoryClassification, securityPolicy), переиспользует core parsers, fail-closed на unknown fields
и fallbacks, immutable snapshot; без file I/O, JSON text, env, credentials, provider activation.

**Build 3.2 storage boundary and schema contract implemented locally, pending independent
adversarial re-review and Codex Review №6.** Explicit lexical storage binding + schema version
contract only (`CURRENT_STORAGE_SCHEMA_VERSION` is the sole current-version source of truth);
filesystem не читается и не изменяется; backend unbound; durability none; writes/migrations/
encryption disabled; durable ports отсутствуют.

**Build 3.3A/B1/B2A/B2B/B2/B3A/B3B2/B3B3/B3B4-F1/B3B5:** SQLite deps pinned; process-lock dependency pinned;
POSIX safe-open existing root; B2B identity capability seal; Build 3.3B2 app-private SQLite
MemoryPort opens `neo-memory.sqlite` only after a genuine open capability (owner identity is
`(ownerId, namespace, recordId)`). Build 3.3B3A enforces same-process root↔adapter lease
coordination (`root.close` busy while adapters hold open/close-pending connections; busy does not
retire the root). Build 3.3B3B3 adds an app-private Linux exclusive process-lock primitive
(`neo.primary.lock`, flock, close-fd release) that is not wired to LocalHost/Neo — Neo
second-instance protection remains inactive. Original B3B4 Linux gate FAILED on missing
`fs.constants.O_CLOEXEC`; B3B4-F1 Candidate C (post-open `getfd`/`FD_CLOEXEC`) was committed;
runtime research probe passed; full repeated B3B4 then PASSED on the pinned Ubuntu 24.04 /
linux-amd64 / Node 22.13.0 stack. Build 3.3B3B5 records
`linuxIntegrationValidatedForPrimitive=true` (evidence only; not NFS, not deployment, not Neo
protection). Build 3.3B3C1 adds a pure app-private durable owner/controller lifecycle (fake
closures only; operation gate; ordered retryable non-reentrant close; snapshotted closers)
without real root/lock/SQLite wiring.
Build 3.3B3C2 adds the app-private Linux-gated POSIX durable composition factory that wires real
POSIX root → process lock → SQLite MemoryPort into a B3C1 owner (startup rollback
SQLite → lock → root) **inside the factory only**. Factory remains app-private / Neo-unwired;
complete composition Linux integration validation recorded (Build 3.3B3C4-FINAL). The B3B3/B3B5 process-lock primitive
itself remains unwired to Neo startup. Build 3.3B3C3 hardens malformed closer/cleanup results,
startup cleanup reentrancy, terminal failure freezing, and exact dynamic-import targets — without
changing Neo wiring or readiness diagnostics. systemd layer pending. Existing `createLocalHost()`
remains in-memory; ApprovalPort/AuditPort ephemeral; no cross-port transaction or encryption.
Сервер/VPS не куплен. Deployment запрещён.
Security approval отсутствует (Codex Review №6 pending). Build №3 целиком не завершён.

Проверка ядра: `npm run check` с `OPENCLAW_PRODUCTION_NODE_GATE=1` — strict production Node gate
(override запрещён). Review/tooling runner может использовать `OPENCLAW_REVIEW_NODE_OVERRIDE=1`
только для локального tooling вне production gate; это не замена verified Node 22.13.0 PASS.
Публичные контракты экспортируются из `src/index.ts`.

Навигация: [архитектура](docs/architecture.md), [расширяемость](docs/extensibility.md),
[интеграции](docs/integrations.md), [VoiceProfile](docs/voice-profile.md),
[роли](docs/roles.md), [безопасность](docs/security-policy.md),
[критерии приёмки](docs/acceptance-criteria.md),
[совместимость OpenClaw](docs/openclaw-compatibility.md).
