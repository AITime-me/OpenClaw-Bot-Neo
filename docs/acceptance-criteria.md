# Критерии приёмки

## Repository safety

- Build №1 foundation сохранён; Build №2 добавляет только согласованные TypeScript core, tests, architectural scripts и draft skills. Адаптеры, providers, integrations, monitors, Docker и runtime отсутствуют.
- Draft config валиден как JSON, явно не deployable и не выдаётся за подтверждённый OpenClaw config.
- Config не полагается на unsafe defaults: deny/read-only/scanner/provider/embedding/paid behavior заданы явно.
- Internal Markdown links разрешаются; likely-secret scan, active-key scan, `git diff --check` и allowlist scope проходят.
- Strict compile, lint, formatting, unit tests, dependency boundaries, secret-pattern и repository-hygiene checks проходят через `npm run check`.
- Build 2.1A закрывает HIGH findings OCN-001—OCN-006 и не добавляет adapters, providers, integrations, monitors, runtime, сеть, БД, scheduler или платёжные функции.
- Build 2.1B добавляет contracts/policies/examples, но не plugin loader, adapter, integration,
  webhook server, call-service connection или TTS provider.

## Extensibility

- Business/technical skill, channel и integration описываются versioned declarative manifest без
  executable/import path, shell command или secrets.
- Unknown schema/kind/field/permission/port/extension и disabled extension дают deny.
- Manifest request не является grant; effective permissions — пересечение deployment, role,
  Security Guard и risk policy с deny priority. Модель и Director не повышают permissions.
- Dangerous permissions имеют explicit deployment grant; external send имеет approval policy.
- Registry принимает только sealed verified manifest, выявляет ID/version conflict, возвращает
  enabled-only listing и не выполняет auto-discovery/dynamic loading.
- Восемь business skills и technical `multimodal-workflow` остаются валидными, но не образуют
  закрытый enum.

## Webhooks, call analysis and voice

- Webhook envelope не хранит raw signature/secret; unknown source, invalid timestamp, replay,
  duplicate event, oversized payload и unavailable verifier fail closed.
- Payload проходит scanner до sinks; webhook не активирует extension.
- Call-analysis skill отделён от external-call-service integration. Audio, transcript и analysis
  имеют раздельные provenance/retention/cleanup; временное audio удаляется.
- «Мои звонки» остаётся UNVERIFIED возможным примером, а не поддерживаемой integration.
- VoiceProfile Нео `ru-RU`, masculine и provider-independent. Feminine/cross-gender fallback,
  voice cloning и identity imitation запрещены; unavailable compatible voice даёт text-only.

## LLM authentication and billing

- Default auth — subscription OAuth; subscription quota не трактуется как API billing.
- `OPENAI_API_KEY` отсутствует в tracked examples и **в фактическом environment процесса OpenClaw**; проверять только source/config недостаточно.
- `OPENAI_API_KEY` в runtime environment — critical error и блокирует startup/readiness.
- API-key auth profile — critical error; runtime не продолжает работу.
- API fallback и paid fallback выключены; скрытого fallback нет.
- При недоступности subscription provider/registry/model discovery маршрут возвращает unavailable, а не выбирает платный или неподтверждённый provider.

## Channel boundaries

- Core и будущие skills импортируют только общий channel contract; transport SDK/types/identifiers запрещены.
- Telegram существует только в adapter boundary; future mobile использует отдельный adapter к тому же core.
- Telegram bot token никогда не достигает memory или logs; synthetic test подтверждает отсутствие во всех sinks.
- Sender/recipient references opaque, allowlisted и не являются доказательством полномочий; replay/rate/size checks применяются на adapter boundary.

## Media

- Multimodal workflow — capability, не девятая роль; media facade отделён от LLM и channels.
- MIME определяется по содержимому и allowlist, а не только extension/header; MIME spoofing блокируется.
- Build №2 синтаксически блокирует loopback/private/link-local literals, unsafe schemes и credential-bearing URL. Проверка resolved IP, каждого redirect и защита от DNS rebinding обязательны для будущего runtime adapter и пока не считаются реализованными.
- PDF/DOCX и архивные inputs имеют size/page/entry/decompression limits; decompression bombs и malformed payloads блокируются.
- Media jobs имеют idempotency key, cancel, cleanup и expiry; повтор не создаёт второй external action.
- External/paid processing выключен, пока capability/provider/privacy не подтверждены.

## Memory

- Разрешены только согласованные namespaces; cross-namespace read/write deny-by-default.
- Каждая запись содержит provenance, source date, confidence, classification и retention; unverified claims не становятся фактами.
- Secret in ordinary string блокируется до memory; TypeScript/static type не считается защитой.
- URL credentials блокируются или маскируются до любого sink.
- Private key block никогда не достигает memory/logs.
- Telegram bot token никогда не достигает memory/logs.
- Scanner unavailable => write denied; timeout/ambiguity/limit также fail closed.
- Quoted assignment редактируется целиком; percent-encoded URL userinfo блокируется; finding не содержит фрагментов исходного секрета; metadata сканируется фактически.
- Query, write, read и delete требуют opaque authenticated gateway context; ordinary
  `MemoryAccessContext` и знание record ID не являются authorization; request body не назначает
  owner/actor/role.
- Raw content не может попасть в `MemoryPort`: sink принимает только sealed write contract, созданный memory-write сервисом; sanitized snapshot deeply immutable и общий для digest/policy/write.
- Delete удаляет сырьё и derived/index entries, оставляя только минимальный redacted audit; результат удаления проверяется.
- Memory embedding provider указан явно (`none` или проверенный local placeholder); внешний provider не выбирается default-ом.

## Automation

- Reminder требует timezone, quiet hours, owner-visible expiry и idempotency; duplicate/retry не создаёт повторную доставку.
- Expired reminder не исполняется; missed run и quiet-hours behavior детерминированы.
- Изменение reminders/subscriptions/quotas требует owner approval и audit.
- Financial/subscription automation только наблюдает и уведомляет; payment, purchase, renewal и cancellation actions отсутствуют.
- Task ledger обеспечивает provenance, idempotency, cancellation, cleanup и expiry либо capability помечается unavailable.

## Model routing

- Routes включают low, medium, high и untrusted; каждый задаёт explicit tool profile, approval и onUnavailable.
- Нет hardcoded confirmed model identifiers: используются только runtime-validated capability tiers.
- High-risk никогда не fallback-ится на weak tier; untrusted content получает no-exec/no-elevated-tools profile.
- Registry unavailable, unknown tier или policy mismatch дают fail-closed unavailable.

## Security

- SensitiveDataScannerPort детерминированно работает до memory, log, external call и audit; порядок
  исполняем в `executeMemoryWrite` и проверяется структурно по AST этой функции (не полный
  interprocedural proof).
- Scanner обрабатывает LF/CRLF после separator fail-closed; проверяет metadata keys и values на
  всех уровнях; unsafe metadata key → deny без попадания ключа в memory/audit/errors/findings.
- Approval scoped, expiring и single-use: demand строится из фактической операции внутри application
  boundary; caller передаёт только `approvalId`. Grant нельзя переиспользовать или применить к
  другому owner, actor, effect, target, namespace, project scope либо изменённому content/metadata;
  expiry проверяется trusted clock; expired, revoked, consumed, malformed и unknown effect
  отклоняются fail-closed до MemoryPort write. Atomic consume — требование port contract.
- Boundary checker обнаруживает static import, export-from, dynamic import, computed
  import/require, переименованный implementation layer, внешний пакет в core, цикл и sealed-модуль
  вне allowlist; zero-file condition не даёт ложный success. Checker не является runtime sandbox.
- Сканируются API keys, bearer credentials, Telegram bot tokens, passwords, cookies, private keys, recovery codes, URL credentials, connection strings и arbitrary text.
- Scanner unavailable => write denied; маскирование не раскрывает совпавшее значение.
- Prompt injection и memory poisoning не меняют policy, approvals, provenance или trusted instructions.
- Build 2.1A покрывает негативными тестами синтаксическую URL policy, включая trailing-dot `localhost`, IPv6 loopback/ULA/link-local и IPv4-mapped IPv6. Полноценные SSRF resolved-IP/redirect checks, DNS rebinding protection, path containment, MIME parsing и decompression-bomb protection остаются обязательными runtime gates и не имитируются текущими заглушками.
- Tool profile ограничивает capabilities/targets/time/size; elevated tools запрещены.
- Public sharing private/restricted data запрещён; cross-border передача минимизируется и требует policy/approval.
- Safe refusal сообщает класс блокировки и следующий безопасный шаг без секрета.
- Build 2.1C закрывает OCN-001, OCN-002, OCN-003 и OCN-006.
- Build 2.1D закрывает B21-001—B21-004: effective risk, registry activation, webhook orchestration,
  Neo voice invariants. Registry storage, HTTP webhook server, cryptography и TTS provider не
  реализованы — только contracts и deterministic policies.
- Build 2.1E закрывает HIGH R2.1-003—R2.1-006: sealed runtime risk evidence; active registration
  только после trusted registry transition; sealed deployment authorization вместо boolean;
  core-owned webhook bytes и core-sealed signature evidence из untrusted verifier result; sealed
  VoiceProvider match evidence. Ordinary object literals не являются proof.
- Build 2.1F закрывает MEDIUM R2.1-001 (metadata traversal budget), R2.1-002 (path-aware memory
  AST) и R2.1-007 (VoiceProfile + production SensitiveDataScanner).
- Build 2.1G закрывает FIN-001 (immutable sanitized snapshot), FIN-002 (authenticated memory
  gateway context) и FIN-003 (WeakMap identity membership вместо Symbol-brand; package exports
  закрывают internal subpaths). FIN-004—FIN-014 не объявлены закрытыми. Окончательный security
  approval до нового Codex review не объявляется. Реальный authentication adapter отсутствует.

## Deployment

- Bot VPS TimeWeb Cloud отделён от российского production; только outbound read-only к allowlisted production/external systems, reverse trust отсутствует.
- Bind loopback-first, inbound restricted, non-root, secrets outside repo, отдельные backup/data/audit boundaries.
- Version pin и controlled update включают release review, staging fixture tests, snapshot/rollback и compatibility matrix.
- Deployment остаётся draft и сейчас не выполняется.

## Checks after runtime installation

- Закрепить фактическую OpenClaw version и выполнить каждую runtime check из [матрицы совместимости](openclaw-compatibility.md).
- Проверить **actual OpenClaw process environment**, а не только source: наличие `OPENAI_API_KEY` — critical error.
- Проверить effective auth profiles: любой API-key auth profile — critical error.
- Проверить effective config на unsafe defaults, provider/registry fallback, explicit memory embedding provider и paid providers off.
- Выполнить adversarial tests scanner sinks, policy bypass/replay, channel boundary, tool profiles, SSRF redirects, media jobs, memory isolation/delete и scheduler idempotency.
- Build №2 проходит strict compile, lint, format, unit tests, dependency boundaries и secret-pattern checks через `npm run check`; runtime/integration/adversarial проверки остаются post-install gates.
