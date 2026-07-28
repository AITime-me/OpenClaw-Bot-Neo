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

До sealing `validateVoiceProfile` прогоняет все текстовые поля (id, language, tone, styleTags,
selectors, schema/fallback identifiers и т.д.) через production SensitiveDataScanner
(`scanSensitiveMetadata` + `scanSensitiveData`). Scanner failure, limit exceeded или sensitive
finding → deny с generic codes (`VOICE_PROFILE_SENSITIVE_DATA` /
`VOICE_PROFILE_SCAN_FAILED` / `VOICE_PROFILE_SCAN_LIMIT_EXCEEDED`) без secret fragments.
`config/voice/neo.example.json` проходит тот же production flow. Caller `{ scanned: true }` не
является proof.

Конкретный TTS provider не выбран и не реализован. Example:
[`config/voice/neo.example.json`](../config/voice/neo.example.json) проходит тот же Neo validator.
