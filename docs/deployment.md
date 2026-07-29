# Deployment draft

Deployment сейчас не выполняется. Это проект границ будущего размещения.

Помощник **planned** на отдельном зарубежном VPS TimeWeb Cloud (сервер не куплен, not deployed). Российский production-сервер остаётся отдельным: он не host помощника и не принимает от него административное доверие. Доступ к наблюдаемым системам — outbound, allowlisted и read-only.

Production Node support: `>=22.13.0 <23`. Review/tooling override (`OPENCLAW_REVIEW_NODE_OVERRIDE=1`) не означает production support Node 24.

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

Точные команды, образы, unit-файлы, порты и OpenClaw-поля не определены. Build №3 не начат, VPS не
куплен, security approval отсутствует pending Codex Review №6. До review, threat model и отдельного
owner approval deployment запрещён.
