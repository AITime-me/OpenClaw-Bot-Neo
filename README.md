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

**Build №2 + Security Remediation 2.1A: verifiable core.** Добавлены strict TypeScript-домен, порты, детерминированные политики безопасности, risk routing, pipeline-контракты, девять draft skills и локальные тесты. Remediation 2.1A закрыла шесть HIGH findings независимого review: approval стал scoped, expiring и одноразовым; порядок «scanner → policy → approval → sinks» реализован исполняемым memory-write сервисом в `src/core/application/`; доступ к памяти требует authenticated context; scanner полностью редактирует quoted-значения и определяет URL credentials каноническим парсингом; URL policy расширена структурной проверкой IP-диапазонов; проверка архитектурных границ переведена на allowlist и анализ AST.

Runtime, адаптеры, providers, интеграции, бот, deployment и рабочая конфигурация по-прежнему отсутствуют. Текущая URL policy не является полной SSRF-защитой: DNS resolution, проверка resolved IP, повторная проверка redirect и защита от DNS rebinding остаются runtime gates.

Навигация: [архитектура](docs/architecture.md), [роли](docs/roles.md), [безопасность](docs/security-policy.md), [критерии приёмки](docs/acceptance-criteria.md), [совместимость OpenClaw](docs/openclaw-compatibility.md).

Проверка ядра: `npm run check`. Публичные контракты экспортируются из `src/index.ts`; security boundary сканирования определён в `SensitiveDataScannerPort`.
