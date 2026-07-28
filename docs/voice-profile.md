# VoiceProfile Нео

`VoiceProfile` описывает желаемый голос независимо от TTS provider. Core не содержит provider name,
voice ID, API endpoint/key или имени реального актёра. Будущий TTS adapter должен сопоставить
логические признаки профиля с доступным голосом provider.

Профиль Нео:

- язык `ru-RU`;
- мужская персона и `genderPresentation: masculine`;
- спокойный, уверенный, интеллектуальный, сдержанный и немного футуристичный тон;
- хорошая русская дикция без дикторского пафоса и интонации колл-центра;
- `allowCrossGenderFallback: false`;
- `allowVoiceCloning: false`;
- `allowIdentityImitation: false`;
- `fallbackMode: text-only`;
- обязательные semantic style tags (`calm`, `intelligent`, `confident`, `restrained`,
  `slightly-futuristic`, `good-russian-diction`, `not-call-center`, `not-pompous-announcer`).

Если `enabled: false`, результат всегда text-only: `primaryAvailable`/`fallbackAvailable` не
включают voice. Voice availability принимает только sealed `VerifiedVoiceProviderMatch` от trusted
validation boundary (`validateVoiceProviderMatch`). Adapter возвращает untrusted metadata result;
ordinary/frozen favorable object literal, model-shaped JSON и mismatch profile/selector/version/
policy/freshness дают text-only. Cloned voice, identity imitation, actor/celebrity association,
feminine/unknown gender и unverified metadata — text-only. Автоматический переход на женский голос
запрещён. Sealer не экспортируется в public API.

Конкретный TTS provider не выбран и не реализован. Example:
[`config/voice/neo.example.json`](../config/voice/neo.example.json) проходит тот же Neo validator.
Полный SensitiveDataScanner для VoiceProfile (R2.1-007) намеренно не закрыт в Build 2.1E.
