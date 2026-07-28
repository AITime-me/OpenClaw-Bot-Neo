import { describe, expect, it } from 'vitest';
import {
  resolveVoiceAvailability,
  validateVoiceProfile,
} from '../src/core/policy/voice-profile.js';

const neo = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'neo',
  schemaVersion: '1.0',
  language: 'ru-RU',
  genderPresentation: 'masculine',
  tone: 'calm-confident-intellectual',
  pace: 'moderate',
  expressiveness: 'restrained',
  styleTags: ['calm', 'clear-russian-diction', 'slightly-futuristic'],
  primaryVoiceSelector: {
    language: 'ru-RU',
    genderPresentation: 'masculine',
    styleTags: ['calm', 'restrained'],
  },
  fallbackVoiceSelectors: [],
  fallbackMode: 'text-only',
  allowCrossGenderFallback: false,
  allowVoiceCloning: false,
  allowIdentityImitation: false,
  enabled: true,
  ...overrides,
});

describe('provider-independent Neo voice profile', () => {
  it('accepts the masculine Russian Neo profile', () => {
    const result = validateVoiceProfile(neo());
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.profile.genderPresentation).toBe('masculine');
      expect(result.profile.primaryVoiceSelector.genderPresentation).toBe('masculine');
      expect(Object.isFrozen(result.profile)).toBe(true);
      expect(Object.isFrozen(result.profile.primaryVoiceSelector)).toBe(true);
    }
  });

  it('rejects a feminine fallback for Neo', () => {
    const result = validateVoiceProfile(
      neo({
        fallbackVoiceSelectors: [
          { language: 'ru-RU', genderPresentation: 'feminine', styleTags: ['calm'] },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe('CROSS_GENDER_FALLBACK_FORBIDDEN');
  });

  it('rejects enabling cross-gender fallback', () => {
    const result = validateVoiceProfile(neo({ allowCrossGenderFallback: true }));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe('CROSS_GENDER_FALLBACK_FORBIDDEN');
  });

  it('rejects voice cloning', () => {
    const result = validateVoiceProfile(neo({ allowVoiceCloning: true }));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe('VOICE_CLONING_FORBIDDEN');
  });

  it('rejects identity imitation', () => {
    const result = validateVoiceProfile(neo({ allowIdentityImitation: true }));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe('IDENTITY_IMITATION_FORBIDDEN');
  });

  it('falls back to text-only when a suitable voice is unavailable', () => {
    const result = validateVoiceProfile(neo());
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(resolveVoiceAvailability(result.profile, false)).toEqual({
      mode: 'text-only',
      reason: 'No policy-compatible voice is available.',
    });
  });

  it('does not require or allow a provider-specific voice ID', () => {
    const result = validateVoiceProfile(
      neo({
        primaryVoiceSelector: {
          language: 'ru-RU',
          genderPresentation: 'masculine',
          styleTags: ['calm'],
          voiceId: 'provider-voice-123',
        },
      }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe('PROVIDER_SPECIFIC_SELECTOR');
  });

  it('denies an unknown gender presentation', () => {
    const result = validateVoiceProfile(neo({ genderPresentation: 'unknown' }));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe('UNKNOWN_GENDER_PRESENTATION');
  });

  it('denies a malformed language', () => {
    const result = validateVoiceProfile(neo({ language: 'russian' }));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe('MALFORMED_LANGUAGE');
  });

  it('denies a profile with no fallback policy', () => {
    const candidate = neo();
    delete candidate.fallbackMode;
    const result = validateVoiceProfile(candidate);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe('MISSING_FALLBACK_POLICY');
  });
});
