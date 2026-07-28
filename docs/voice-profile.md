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
- `fallbackMode: text-only`.

Если подходящий мужской голос недоступен, ответ остаётся текстовым. Автоматический переход на
женский голос запрещён. Voice cloning и имитация реального актёра/личности запрещены для любого
валидного профиля.

Конкретный TTS provider не выбран и не реализован. Example:
[`config/voice/neo.example.json`](../config/voice/neo.example.json).
