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
- зарубежный VPS TimeWeb Cloud размещает помощника отдельно от российского production-сервера и не является его хостом;
- доверие одностороннее: помощник наблюдает разрешённые системы, обратного доверия к нему нет;
- основной доступ к LLM — ChatGPT Plus/Codex OAuth; автоматического перехода на API-биллинг нет;
- платные fallback-провайдеры выключены;
- секреты, персональные данные и неподтверждённые сведения не попадают в репозиторий.

## Статус

**Build №2 + Security Remediation 2.1A–2.1F + Extensibility 2.1B/2.1D + Trusted Evidence 2.1E:
verifiable core.**
Build 2.1B добавляет versioned declarative manifests, default-deny permission composition,
provider-independent registry/webhook contracts, отключённые examples для call-analysis и external
call service, а также мужской VoiceProfile Нео. Manifest не является кодом и не выдаёт полномочия;
подходящий мужской голос недоступен — используется text-only, без женского fallback.

Build 2.1C закрывает OCN-001/002/003/006: approval binding к фактической memory operation и trusted
clock, scanner newline/metadata-key policy, target-specific memory AST order и запрет computed
`import`/`require`.

Build 2.1D закрывает B21-001—B21-004: effective risk + approval-effect mapping, sealed registry
activation state, webhook orchestration с payload-bound signature evidence, Neo-specific
VoiceProfile invariants и `enabled` → text-only.

Build 2.1E закрывает HIGH findings R2.1-003—R2.1-006: runtime risk и VoiceProvider — только sealed
evidence trusted boundary; active registration — только после registry transition; deployment
boolean не является authorization; webhook canonical bytes принадлежат core, verifier возвращает
untrusted primitive result, sealing выполняет core. Ordinary object literals не являются proof.

Build 2.1F закрывает MEDIUM R2.1-001/002/007: единый fail-closed metadata traversal budget
(containers/empty nodes/key length/depth); path-aware conservative memory isolation checker
(normalization + untrusted marking в обязательном порядке; split-branch → fail); VoiceProfile
проходит production SensitiveDataScanner до sealing. Независимый Codex Review №4 ещё не выполнен.
Реальных adapters/providers/runtime по-прежнему нет.

Runtime, plugin loader, адаптеры, providers, реальные integrations/webhooks, TTS, бот, deployment и
рабочая конфигурация по-прежнему отсутствуют. Текущая URL policy не является полной SSRF-защитой:
DNS resolution, проверка resolved IP, повторная проверка redirect и защита от DNS rebinding остаются
runtime gates.

Навигация: [архитектура](docs/architecture.md), [расширяемость](docs/extensibility.md),
[интеграции](docs/integrations.md), [VoiceProfile](docs/voice-profile.md),
[роли](docs/roles.md), [безопасность](docs/security-policy.md),
[критерии приёмки](docs/acceptance-criteria.md),
[совместимость OpenClaw](docs/openclaw-compatibility.md).

Проверка ядра: `npm run check`. Публичные контракты экспортируются из `src/index.ts`; security boundary сканирования определён в `SensitiveDataScannerPort`.
