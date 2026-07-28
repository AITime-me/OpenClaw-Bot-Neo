import { describe, expect, it } from 'vitest';
import type { VoiceProviderMatchEvidence } from '../src/core/domain/index.js';
import {
  resolveVoiceAvailability,
  validateVoiceProfile,
} from '../src/core/policy/voice-profile.js';
import { readFileSync } from 'node:fs';
import * as publicApi from '../src/index.js';

const neoStyleTags = [
  'calm',
  'intelligent',
  'confident',
  'restrained',
  'slightly-futuristic',
  'good-russian-diction',
  'not-call-center',
  'not-pompous-announcer',
];

const neo = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'neo',
  schemaVersion: '1.0',
  language: 'ru-RU',
  genderPresentation: 'masculine',
  tone: 'calm-confident-intellectual',
  pace: 'moderate',
  expressiveness: 'restrained',
  styleTags: neoStyleTags,
  primaryVoiceSelector: {
    language: 'ru-RU',
    genderPresentation: 'masculine',
    styleTags: ['calm', 'restrained', 'good-russian-diction'],
  },
  fallbackVoiceSelectors: [],
  fallbackMode: 'text-only',
  allowCrossGenderFallback: false,
  allowVoiceCloning: false,
  allowIdentityImitation: false,
  enabled: true,
  ...overrides,
});

const verifiedProvider = (
  overrides: Partial<VoiceProviderMatchEvidence> = {},
): VoiceProviderMatchEvidence => ({
  language: 'ru-RU',
  genderPresentation: 'masculine',
  compatibleWithSelector: true,
  actorOrCelebrityIdentity: false,
  clonedVoice: false,
  identityImitation: false,
  metadataVerified: true,
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

  it('validates config/voice/neo.example.json with the same policy', () => {
    const config = JSON.parse(readFileSync('config/voice/neo.example.json', 'utf8')) as unknown;
    const result = validateVoiceProfile(config);
    expect(result.valid).toBe(true);
  });

  it.each([
    [
      'NEO_LANGUAGE_REQUIRED',
      {
        language: 'en-US',
        primaryVoiceSelector: {
          language: 'en-US',
          genderPresentation: 'masculine',
          styleTags: ['calm'],
        },
      },
    ],
    [
      'NEO_MASCULINE_REQUIRED',
      {
        genderPresentation: 'feminine',
        primaryVoiceSelector: {
          language: 'ru-RU',
          genderPresentation: 'feminine',
          styleTags: ['calm'],
        },
      },
    ],
    ['NEO_FALLBACK_REQUIRED', { fallbackMode: 'same-gender-only' }],
    ['CROSS_GENDER_FALLBACK_FORBIDDEN', { allowCrossGenderFallback: true }],
    ['VOICE_CLONING_FORBIDDEN', { allowVoiceCloning: true }],
    ['IDENTITY_IMITATION_FORBIDDEN', { allowIdentityImitation: true }],
    ['NEO_STYLE_TAG_REQUIRED', { styleTags: ['calm'] }],
    ['NEO_FORBIDDEN_STYLE_TAG', { styleTags: [...neoStyleTags, 'celebrity'] }],
  ])('denies Neo invariant %s', (code, overrides) => {
    const result = validateVoiceProfile(neo(overrides));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe(code);
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
    if (!result.valid)
      expect(['CROSS_GENDER_FALLBACK_FORBIDDEN', 'NEO_MASCULINE_REQUIRED']).toContain(result.code);
  });

  it('returns text-only when Neo is disabled', () => {
    const result = validateVoiceProfile(neo({ enabled: false }));
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(resolveVoiceAvailability(result.profile, true, [], verifiedProvider())).toEqual({
      mode: 'text-only',
      reason: 'Voice profile is disabled.',
    });
  });

  it('returns text-only without verified provider metadata', () => {
    const result = validateVoiceProfile(neo());
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(resolveVoiceAvailability(result.profile, true)).toEqual({
      mode: 'text-only',
      reason: 'Provider metadata is unverified.',
    });
  });

  it.each([
    ['language mismatch', { language: 'en-US' }, 'Provider language does not match the profile.'],
    [
      'gender mismatch',
      { genderPresentation: 'feminine' as const },
      'Provider gender presentation does not match.',
    ],
    ['cloned voice', { clonedVoice: true }, 'Cloned voices are forbidden.'],
    ['identity imitation', { identityImitation: true }, 'Identity imitation is forbidden.'],
  ])('returns text-only for %s', (_name, override, reason) => {
    const result = validateVoiceProfile(neo());
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(resolveVoiceAvailability(result.profile, true, [], verifiedProvider(override))).toEqual({
      mode: 'text-only',
      reason,
    });
  });

  it('allows voice only with verified masculine ru-RU provider evidence', () => {
    const result = validateVoiceProfile(neo());
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(resolveVoiceAvailability(result.profile, true, [], verifiedProvider())).toEqual({
      mode: 'voice',
      selector: result.profile.primaryVoiceSelector,
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

  it('does not export sealed voice factories', () => {
    expect(Object.keys(publicApi)).not.toContain('sealValidatedVoiceProfile');
  });
});
