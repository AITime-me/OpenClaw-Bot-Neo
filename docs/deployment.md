# Deployment draft

Deployment сейчас не выполняется. Это проект границ будущего размещения.

Помощник **planned** на отдельном зарубежном VPS TimeWeb Cloud (сервер не куплен, not deployed). Российский production-сервер остаётся отдельным: он не host помощника и не принимает от него административное доверие. Доступ к наблюдаемым системам — outbound, allowlisted и read-only.

Production Node support: `>=22.13.0 <23`. FIN-012 **CLOSED / VERIFIED** на локальном Node
22.13.0 (npm 10.9.2) со strict `OPENCLAW_PRODUCTION_NODE_GATE=1` и exact `@types/node@22.13.10`.
Review/tooling override (`OPENCLAW_REVIEW_NODE_OVERRIDE=1`) не заменяет production verification
и не означает production support для Node 24.

Production entrypoint и wiring strict Node gate пока **not implemented**. DNS resolution,
redirect/rebinding SSRF checks, path/symlink-root isolation, MIME content sniffing,
decompression-bomb limits, quarantine, persistent atomic replay/idempotency storage, real
provider/auth stores и VPS hardening ниже являются **planned requirements**, а не действующими
deployment controls.

## Минимальный профиль

- bind loopback-first; inbound ports закрыты, кроме отдельно обоснованного termination point;
- host firewall и provider firewall deny-by-default;
- non-root service identity, минимальная файловая и сетевая область;
- secrets и OAuth material вне repository/config, с отдельной ротацией;
- данные, backup и audit не смешиваются с production backups;
- backup шифруется, тестируется на восстановление и сохраняет namespace/retention boundaries;
- runtime/version pin только после compatibility validation;
- controlled update: review release notes, snapshot, staging test, health check, rollback;
- наблюдение не даёт reverse shell, shared keys или обратного trust.

Точные команды, образы, unit-файлы, порты и OpenClaw-поля не определены. Build 3.2 добавляет только
pure lexical storage binding/schema contract без filesystem I/O, без durable adapters и без
deployment wiring; lexical path accept не означает filesystem-open-safe и не разрешает ADS/reserved
device roots. Build 3.3A pin'ит SQLite npm dependencies без adapter. Build 3.3B1 добавляет
app-private POSIX/Linux safe-open уже существующего storage root (рекомендуемый смысл
`/var/lib/openclaw-neo`) с explicit ownership/mode/repository policy; не создаёт directory, не
открывает SQLite/database, не включает writes/durability, не даёт exclusive lock, не устраняет
полностью TOCTOU, не защищает от privileged local attacker, не проверен в Ubuntu 24.04 container и
не является deployment approval. Planned target: зарубежный VPS Timeweb Cloud
(4 vCPU / 8 ГБ / 80 ГБ NVMe), Ubuntu 24.04 LTS, Linux server-only, non-root service user; Windows —
только Cursor/Git/static checks/unit tests, не agent runtime. Build 3.3B2A добавляет обязательный
`MemoryQueryRequest.limit` (1..100, без default); Build 3.3B2B seals successful B1 open как
identity-based runtime capability. Build 3.3B2 добавляет app-private SQLite MemoryPort adapter
(`createSqliteMemoryPort`) с database только внутри genuine open safe-root; Build 3.3B3A добавляет
same-process root↔adapter lease coordination (`root.close` busy while adapters hold connections).
Build 3.3B3B2 pin'ит `fs-ext-extra-prebuilt@2.2.10`; Build 3.3B3B3 добавляет app-private Linux
exclusive process-lock primitive (`neo.primary.lock`, flock, close-fd release) **без** LocalHost/Neo
wiring — Neo second-instance protection inactive. Original B3B4 Linux gate FAILED
(`fs.constants.O_CLOEXEC` undefined on Node v22.13.0); Build 3.3B3B4-F1 Candidate C (post-open
`getfd`/`FD_CLOEXEC`) committed; runtime research probe passed; full repeated B3B4 PASSED on
Ubuntu 24.04 / linux-amd64 / Node 22.13.0. Build 3.3B3B5 records
`linuxIntegrationValidatedForPrimitive=true` (pinned-target evidence only; not NFS, not deployment).
systemd unit/layer pending. Build 3.3B3C1 adds pure durable owner/controller lifecycle over fake
closures only (non-reentrant ordered close; snapshotted closers). Build 3.3B3C2 wires real POSIX
root → process lock → SQLite MemoryPort into that owner via an app-private Linux-gated factory
with deterministic startup rollback; factory is not connected to Neo startup; complete composition
Linux integration gate pending B3C4. Existing `createLocalHost()` остаётся in-memory;
process lock не участвует в Neo startup lifecycle; approval/audit ephemeral; cross-port transaction /
encryption отсутствуют; не является deployment approval. Build №3 не завершён, VPS не куплен,
security approval отсутствует pending Codex Review №6. До review, threat model и отдельного owner
approval deployment запрещён.
