# Deployment draft

Deployment сейчас не выполняется. Это проект границ будущего размещения.

Помощник предполагается на отдельном зарубежном VPS TimeWeb Cloud. Российский production-сервер остаётся отдельным: он не host помощника и не принимает от него административное доверие. Доступ к наблюдаемым системам — outbound, allowlisted и read-only.

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

Точные команды, образы, unit-файлы, порты и OpenClaw-поля не определены. До security review, threat model и owner approval deployment запрещён.
