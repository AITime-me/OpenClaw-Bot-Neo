import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { VoiceProviderMetadataResult } from '../src/core/domain/index.js';
import {
  resolveVoiceAvailability,
  validateVoiceProfile,
  validateVoiceProviderMatch,
} from '../src/core/policy/voice-profile.js';
import { MAX_SCAN_INPUT_LENGTH } from '../src/core/policy/sensitive-data-scanner.js';
import {
  BEARER_HEADER,
  CONNECTION_STRING,
  PEM_BLOCK,
  QUOTED_API_KEY_LINE,
  QUOTED_PASSWORD_LINE,
  URL_WITH_CREDENTIALS,
} from './support/synthetic-secrets.js';
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

const rawProvider = (
  overrides: Partial<VoiceProviderMetadataResult> = {},
): VoiceProviderMetadataResult => ({
  providerVoiceReference: 'logical-masculine-ru',
  language: 'ru-RU',
  genderPresentation: 'masculine',
  compatibleWithSelector: true,
  actorOrCelebrityIdentity: false,
  clonedVoice: false,
  identityImitation: false,
  metadataVerified: true,
  ...overrides,
});

const sealedProvider = (
  profile: ReturnType<typeof validateVoiceProfile> & { valid: true },
  overrides: Partial<VoiceProviderMetadataResult> = {},
  now = new Date('2026-07-28T12:00:10.000Z'),
) => {
  const validated = validateVoiceProviderMatch(profile.profile, rawProvider(overrides), {
    policyVersion: 'voice-policy@1',
    now,
    ttlMs: 60_000,
  });
  if (!validated.ok) throw new Error(validated.reason);
  return validated.evidence;
};

describe('provider-independent Neo voice profile', () => {
  it('accepts the masculine Russian Neo profile', () => {
    const result = validateVoiceProfile(neo());
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.profile.genderPresentation).toBe('masculine');
      expect(Object.isFrozen(result.profile)).toBe(true);
    }
  });

  it('validates config/voice/neo.example.json with the same policy', () => {
    const config = JSON.parse(readFileSync('config/voice/neo.example.json', 'utf8')) as unknown;
    expect(validateVoiceProfile(config).valid).toBe(true);
  });

  it('rejects favorable ordinary provider objects as evidence', () => {
    const result = validateVoiceProfile(neo());
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const favorable = Object.freeze(rawProvider());
    expect(resolveVoiceAvailability(result.profile, true, [], favorable as never)).toEqual({
      mode: 'text-only',
      reason: 'Provider metadata is unverified.',
    });
    expect(
      resolveVoiceAvailability(result.profile, true, [], {
        ...favorable,
        metadataVerified: true,
      } as never),
    ).toEqual({ mode: 'text-only', reason: 'Provider metadata is unverified.' });
  });

  it('allows voice only with sealed masculine ru-RU provider evidence', () => {
    const result = validateVoiceProfile(neo());
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const evidence = sealedProvider(result);
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(
      resolveVoiceAvailability(
        result.profile,
        true,
        [],
        evidence,
        new Date('2026-07-28T12:00:10.000Z'),
      ),
    ).toEqual({ mode: 'voice', selector: result.profile.primaryVoiceSelector });
  });

  it('returns text-only for mismatched, stale or unsafe provider metadata', () => {
    const result = validateVoiceProfile(neo());
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(
      validateVoiceProviderMatch(result.profile, rawProvider({ language: 'en-US' }), {
        policyVersion: 'voice-policy@1',
        now: new Date('2026-07-28T12:00:10.000Z'),
        ttlMs: 60_000,
      }).ok,
    ).toBe(false);
    expect(
      validateVoiceProviderMatch(result.profile, rawProvider({ genderPresentation: 'feminine' }), {
        policyVersion: 'voice-policy@1',
        now: new Date('2026-07-28T12:00:10.000Z'),
        ttlMs: 60_000,
      }).ok,
    ).toBe(false);
    expect(
      validateVoiceProviderMatch(result.profile, rawProvider({ clonedVoice: true }), {
        policyVersion: 'voice-policy@1',
        now: new Date('2026-07-28T12:00:10.000Z'),
        ttlMs: 60_000,
      }).ok,
    ).toBe(false);
    expect(
      validateVoiceProviderMatch(result.profile, rawProvider({ identityImitation: true }), {
        policyVersion: 'voice-policy@1',
        now: new Date('2026-07-28T12:00:10.000Z'),
        ttlMs: 60_000,
      }).ok,
    ).toBe(false);
    expect(
      validateVoiceProviderMatch(result.profile, rawProvider({ actorOrCelebrityIdentity: true }), {
        policyVersion: 'voice-policy@1',
        now: new Date('2026-07-28T12:00:10.000Z'),
        ttlMs: 60_000,
      }).ok,
    ).toBe(false);
    expect(
      validateVoiceProviderMatch(result.profile, rawProvider({ metadataVerified: false }), {
        policyVersion: 'voice-policy@1',
        now: new Date('2026-07-28T12:00:10.000Z'),
        ttlMs: 60_000,
      }).ok,
    ).toBe(false);

    const evidence = sealedProvider(result);
    expect(
      resolveVoiceAvailability(
        result.profile,
        true,
        [],
        evidence,
        new Date('2026-07-28T13:00:10.000Z'),
      ),
    ).toEqual({ mode: 'text-only', reason: 'Provider evidence is stale.' });
  });

  it('returns text-only when Neo is disabled', () => {
    const result = validateVoiceProfile(neo({ enabled: false }));
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(resolveVoiceAvailability(result.profile, true, [], null)).toEqual({
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
    ['VOICE_CLONING_FORBIDDEN', { allowVoiceCloning: true }],
    ['IDENTITY_IMITATION_FORBIDDEN', { allowIdentityImitation: true }],
  ])('denies Neo invariant %s', (code, overrides) => {
    const result = validateVoiceProfile(neo(overrides));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe(code);
  });

  it.each([
    ['tone', { tone: QUOTED_API_KEY_LINE }],
    ['styleTags', { styleTags: [...neoStyleTags, QUOTED_PASSWORD_LINE] }],
    [
      'primary selector',
      {
        primaryVoiceSelector: {
          language: 'ru-RU',
          genderPresentation: 'masculine',
          styleTags: ['calm', BEARER_HEADER],
        },
      },
    ],
    [
      'fallback selector',
      {
        fallbackVoiceSelectors: [
          {
            language: 'ru-RU',
            genderPresentation: 'masculine',
            styleTags: [CONNECTION_STRING],
          },
        ],
      },
    ],
    ['url credentials', { tone: `note ${URL_WITH_CREDENTIALS}` }],
    ['private key', { tone: PEM_BLOCK }],
  ])('rejects synthetic secrets in %s via production scanner', (_label, overrides) => {
    const result = validateVoiceProfile(neo(overrides));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect([
        'VOICE_PROFILE_SENSITIVE_DATA',
        'NEO_IDENTITY_FORBIDDEN',
        'NEO_STYLE_TAG_REQUIRED',
        'INVALID_PROFILE',
      ]).toContain(result.code);
      expect(JSON.stringify(result)).not.toContain('QwErTyU');
      expect(JSON.stringify(result)).not.toContain('wonderland');
      expect(JSON.stringify(result)).not.toContain('trustno1');
      expect(JSON.stringify(result)).not.toContain('c3ludGhldGlj');
    }
  });

  it('rejects oversized text and caller scan claims', () => {
    const oversized = validateVoiceProfile(neo({ tone: 'x'.repeat(MAX_SCAN_INPUT_LENGTH + 1) }));
    expect(oversized.valid).toBe(false);
    if (!oversized.valid) expect(oversized.code).toBe('VOICE_PROFILE_SCAN_LIMIT_EXCEEDED');

    const claimed = validateVoiceProfile(neo({ scanned: true }));
    expect(claimed.valid).toBe(false);
    if (!claimed.valid) expect(claimed.code).toBe('INVALID_PROFILE');
  });

  it('does not export sealed voice provider factories', () => {
    const names = Object.keys(publicApi);
    expect(names).not.toContain('sealVerifiedVoiceProviderMatch');
    expect(names).not.toContain('sealValidatedVoiceProfile');
    expect(names).not.toContain('scanVoiceProfileSecrets');
    expect(names).toContain('validateVoiceProviderMatch');
  });
});
