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
включают voice. При отсутствии verified provider metadata, mismatch языка/gender, cloned voice или
identity imitation — text-only. Автоматический переход на женский голос запрещён.

Конкретный TTS provider не выбран и не реализован. Example:
[`config/voice/neo.example.json`](../config/voice/neo.example.json) проходит тот же Neo validator.
