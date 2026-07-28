# Расширяемость

Build 2.1B задаёт контракты будущих расширений, но не загружает и не исполняет сторонний код.

## Разделение ответственности

- **Skill** описывает анализ, планирование, классификацию, рекомендации или работу с видом данных.
- **Channel/integration adapter** аутентифицирует источник, переводит внешний протокол в core
  contract и доставляет результат.
- Skill не знает service authentication, webhook headers, provider API, URL, secret names,
  Telegram-поля или TTS voice IDs.
- Integration не получает бизнес-логику skill и не наследует memory access.
- Core не импортирует реализации skills, channels или integrations.

Текущие восемь business-role skills и один технический `multimodal-workflow` сохраняются. Это
текущий набор, а не закрытый enum.

## Extension manifest 1.0

`ExtensionManifest` — только декларативные metadata: identity/version/kind, versioned capability
identifiers, необходимые core ports, запрошенные security permissions, fixed risk class, approval
policy, data classifications, I/O kinds, provenance, owner scope и флаг `enabled`.

Manifest:

- не содержит executable/import/module path, shell command, произвольный код или secret value;
- не является plugin package и ничего не устанавливает;
- не активирует себя и не выдаёт себе requested permissions;
- отклоняется при неизвестном поле, kind, permission, port или schema version;
- после проверки глубоко замораживается, поэтому risk class нельзя изменить;
- регистрируется только доверенным application/deployment flow;
- `enabled: false` может быть зарегистрирован как metadata со state `disabled`, но не становится
  `active`; `enabled: true` после регистрации даёт только `pending-policy`, не permissions.

Capabilities имеют форму `namespace.name@major`. Permissions принадлежат фиксированному каталогу
security primitives. Новая capability не создаёт новый permission.

Dangerous permissions (`memory-write`, `secrets-read`, `exec`, `external-send`, `integration-write`,
`schedule-write`, `notifications-send`) требуют matching approval effects. Пустой или неверный
список effects — deny. Manifest risk нельзя понизить runtime-параметром: effective risk = max
(manifest, trusted runtime).

## Registry activation

Sealed registry entry хранит `activationState`: `disabled` | `pending-policy` | `active` |
`rejected`. Permissions выдаются только sealed active evidence. `manifest.enabled` не означает
active. Trusted activation — отдельный service; ordinary boolean `registered` удалён.

## Permission composition

Фактический набор — пересечение manifest request, deployment allowlist, role policy, Security Guard
policy и runtime risk policy. Deny имеет приоритет, включая над Director. Unknown extension,
disabled extension, unknown permission и model-authored permission override дают deny.

`memory-write`, `secrets-read`, `exec`, `external-send` и `integration-write` требуют явного
deployment grant; `external-send` также требует approval policy. Integration не получает memory
access, channel — business memory, technical skill — exec, а skill — credentials автоматически.

## Registry

`ExtensionRegistryPort` поддерживает проверенную регистрацию, lookup по ID/version, enabled-only
listing, conflict check и чтение capabilities/requested permissions. Реализация будет вне core.
Нет auto-discovery, dynamic import, download, hot load, marketplace или package installation.

OpenClaw-specific механизм загрузки skills остаётся **UNVERIFIED**. Manifest Build 2.1B не
утверждает совместимость с ним.

См. [интеграции](integrations.md), [security policy](security-policy.md) и
[VoiceProfile](voice-profile.md).
