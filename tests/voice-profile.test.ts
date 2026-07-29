import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ok, type VoiceProviderMetadataResult } from '../src/core/domain/index.js';
import { sealVerifiedVoiceProviderMatch } from '../src/core/domain/voice-profile.internal.js';
import {
  createVoiceResolutionGateway,
  parseVoiceProviderObservation,
} from '../src/core/application/voice-resolution.gateway.js';
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
import { asCorrelation, fixedClock, operationContext } from './support/fixtures.js';
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
  now = new Date('2026-07-28T12:00:10.000Z'),
) =>
  sealVerifiedVoiceProviderMatch({
    profileId: profile.profile.id,
    profileSchemaVersion: profile.profile.schemaVersion,
    selector: profile.profile.primaryVoiceSelector,
    providerVoiceReference: 'logical-masculine-ru',
    language: 'ru-RU',
    genderPresentation: 'masculine',
    policyVersion: 'voice-policy@1',
    validatedAt: now.toISOString() as never,
    expiresAt: new Date(now.getTime() + 60_000).toISOString() as never,
  });

const trustedVoiceGateway = (
  profile: ReturnType<typeof validateVoiceProfile> & { valid: true },
  overrides: {
    readonly observation?: Record<string, unknown>;
    readonly configuration?: Record<string, unknown>;
    readonly unavailable?: 'provider' | 'configuration' | 'policy';
    readonly onPolicyRead?: () => void;
  } = {},
) =>
  createVoiceResolutionGateway({
    clock: fixedClock('2026-07-28T12:00:10.000Z'),
    policy: {
      currentPolicy: () => {
        overrides.onPolicyRead?.();
        return overrides.unavailable === 'policy'
          ? Promise.resolve({ ok: false, error: { code: 'UNAVAILABLE', reason: 'policy' } })
          : Promise.resolve(
              ok({
                policyVersion: 'voice-policy@1',
                evidenceTtlMs: 60_000,
                issuedAt: '2026-07-28T12:00:00.000Z',
                expiresAt: '2026-07-28T12:30:00.000Z',
              }),
            );
      },
    },
    configuration: {
      currentConfiguration: () =>
        overrides.unavailable === 'configuration'
          ? Promise.resolve({ ok: false, error: { code: 'UNAVAILABLE', reason: 'config' } })
          : Promise.resolve(
              ok({
                providerIdentity: 'provider-a',
                expectedVoiceReference: 'logical-masculine-ru',
                configurationRevision: 'cfg-1',
                language: 'ru-RU',
                genderPresentation: 'masculine',
                metadataSourceReference: 'meta-src',
                allowClonedVoice: false,
                allowIdentityImitation: false,
                allowActorOrCelebrityIdentity: false,
                policyVersion: 'voice-policy@1',
                issuedAt: '2026-07-28T12:00:00.000Z',
                expiresAt: '2026-07-28T12:30:00.000Z',
                ...overrides.configuration,
              }),
            ),
    },
    provider: {
      observe: () =>
        overrides.unavailable === 'provider'
          ? Promise.resolve({ ok: false, error: { code: 'UNAVAILABLE', reason: 'provider' } })
          : Promise.resolve(
              ok({
                providerIdentity: 'provider-a',
                providerVoiceReference: 'logical-masculine-ru',
                observedLanguage: 'ru-RU',
                observedGenderPresentation: 'masculine',
                metadataSourceReference: 'meta-src',
                claimsClonedVoice: false,
                claimsIdentityImitation: false,
                claimsActorOrCelebrityIdentity: false,
                providerConfigurationRevision: 'cfg-1',
                correlationId: asCorrelation(),
                observedAt: '2026-07-28T12:00:00.000Z',
                expiresAt: '2026-07-28T12:30:00.000Z',
                ...overrides.observation,
              }),
            ),
    },
  });

describe('provider-independent Neo voice profile', () => {
  it('snapshots provider observations and rejects executable shapes', () => {
    const raw = {
      providerIdentity: 'provider-a',
      providerVoiceReference: 'logical-masculine-ru',
      observedLanguage: 'ru-RU',
      observedGenderPresentation: 'masculine',
      metadataSourceReference: 'provider-config-a',
      claimsClonedVoice: false,
      claimsIdentityImitation: false,
      claimsActorOrCelebrityIdentity: false,
      providerConfigurationRevision: 'revision-1',
      correlationId: asCorrelation(),
      observedAt: '2026-07-28T12:00:00.000Z',
      expiresAt: '2026-07-28T12:30:00.000Z',
    };
    const parsed = parseVoiceProviderObservation(
      raw,
      { correlationId: asCorrelation() },
      new Date('2026-07-28T12:00:10.000Z'),
    );
    expect(parsed).not.toBeNull();
    if (parsed === null) return;
    raw.providerVoiceReference = 'changed';
    expect(parsed.providerVoiceReference).toBe('logical-masculine-ru');
    expect(Object.isFrozen(parsed)).toBe(true);

    let reads = 0;
    const getter = { ...raw, providerVoiceReference: 'logical-masculine-ru' };
    Object.defineProperty(getter, 'claimsClonedVoice', {
      enumerable: true,
      get() {
        reads += 1;
        return false;
      },
    });
    expect(
      parseVoiceProviderObservation(
        getter,
        { correlationId: asCorrelation() },
        new Date('2026-07-28T12:00:10.000Z'),
      ),
    ).toBeNull();
    expect(reads).toBe(0);
    expect(
      parseVoiceProviderObservation(
        new Proxy({ ...raw, providerVoiceReference: 'logical-masculine-ru' }, {}),
        { correlationId: asCorrelation() },
        new Date('2026-07-28T12:00:10.000Z'),
      ),
    ).toBeNull();
  });

  it('accepts the masculine Russian Neo profile', () => {
    const result = validateVoiceProfile(neo());
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.profile.genderPresentation).toBe('masculine');
      expect(Object.isFrozen(result.profile)).toBe(true);
    }
  });

  it('snapshots once and rejects getters, proxies, methods and custom prototypes', () => {
    let reads = 0;
    const getter = neo();
    Object.defineProperty(getter, 'genderPresentation', {
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1 ? 'masculine' : 'feminine';
      },
    });
    expect(validateVoiceProfile(getter).valid).toBe(false);
    expect(reads).toBe(0);

    expect(validateVoiceProfile(new Proxy(neo(), {})).valid).toBe(false);
    expect(
      validateVoiceProfile(
        neo({
          primaryVoiceSelector: {
            language: 'ru-RU',
            genderPresentation: 'masculine',
            styleTags: ['calm'],
            valueOf() {
              throw new Error('must not execute');
            },
          },
        }),
      ).valid,
    ).toBe(false);
    expect(
      validateVoiceProfile(Object.assign(Object.create({ inherited: true }), neo())).valid,
    ).toBe(false);
  });

  it('retains no caller arrays and seals the same masculine snapshot it validates', () => {
    const styles = [...neoStyleTags];
    const primaryStyles = ['calm', 'restrained', 'good-russian-diction'];
    const candidate = neo({
      styleTags: styles,
      primaryVoiceSelector: {
        language: 'ru-RU',
        genderPresentation: 'masculine',
        styleTags: primaryStyles,
      },
    });
    const result = validateVoiceProfile(candidate);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    styles[0] = 'feminine';
    primaryStyles[0] = 'actor-imitation';
    Object.assign(candidate, { genderPresentation: 'feminine' });
    expect(result.profile.genderPresentation).toBe('masculine');
    expect(result.profile.styleTags[0]).toBe('calm');
    expect(result.profile.primaryVoiceSelector.styleTags[0]).toBe('calm');
    expect(Object.isFrozen(result.profile.styleTags)).toBe(true);
  });

  it('rejects sparse, cyclic, symbol and custom-iterator profile data', () => {
    const sparse = neo();
    const styles = new Array<string>(neoStyleTags.length);
    styles[1] = 'intelligent';
    sparse.styleTags = styles;
    expect(validateVoiceProfile(sparse).valid).toBe(false);

    const cyclic = neo();
    cyclic.primaryVoiceSelector = cyclic;
    expect(validateVoiceProfile(cyclic).valid).toBe(false);
    expect(validateVoiceProfile({ ...neo(), [Symbol('hidden')]: true }).valid).toBe(false);
    expect(
      validateVoiceProfile(
        neo({
          fallbackVoiceSelectors: Object.assign([], {
            [Symbol.iterator]: () => {
              throw new Error('must not execute');
            },
          }),
        }),
      ).valid,
    ).toBe(false);
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

  it('returns text-only for mismatched, stale or unsafe provider metadata', async () => {
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

    const feminine = await trustedVoiceGateway(result, {
      observation: { observedGenderPresentation: 'feminine' },
      configuration: { genderPresentation: 'feminine' },
    }).resolve(
      {
        profile: result.profile,
        selector: result.profile.primaryVoiceSelector,
        correlationId: asCorrelation(),
        providerReference: 'provider-a',
      },
      operationContext(),
    );
    expect(feminine.ok && feminine.value.mode).toBe('text-only');

    const cloned = await trustedVoiceGateway(result, {
      observation: { claimsClonedVoice: true },
    }).resolve(
      {
        profile: result.profile,
        selector: result.profile.primaryVoiceSelector,
        correlationId: asCorrelation(),
        providerReference: 'provider-a',
      },
      operationContext(),
    );
    expect(cloned.ok && cloned.value.mode).toBe('text-only');

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

  it('resolves masculine ru-RU voice only through trusted gateway dependencies', async () => {
    const result = validateVoiceProfile(neo());
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const resolved = await trustedVoiceGateway(result).resolve(
      {
        profile: result.profile,
        selector: result.profile.primaryVoiceSelector,
        correlationId: asCorrelation(),
        providerReference: 'provider-a',
      },
      operationContext(),
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.mode).toBe('voice');
    if (resolved.value.mode === 'voice') {
      expect(Object.isFrozen(resolved.value.evidence)).toBe(true);
      expect(
        resolveVoiceAvailability(
          result.profile,
          true,
          [],
          resolved.value.evidence,
          new Date('2026-07-28T12:00:10.000Z'),
        ),
      ).toEqual({ mode: 'voice', selector: result.profile.primaryVoiceSelector });
    }
  });

  it('snapshots the requested selector before the first adapter await', async () => {
    const result = validateVoiceProfile(neo());
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const mutableSelector = {
      language: 'ru-RU',
      genderPresentation: 'masculine' as const,
      styleTags: ['calm', 'restrained', 'good-russian-diction'],
    };
    const resolved = await trustedVoiceGateway(result, {
      onPolicyRead: () => {
        mutableSelector.language = 'en-US';
        mutableSelector.styleTags.push('mutated');
      },
    }).resolve(
      {
        profile: result.profile,
        selector: mutableSelector,
        correlationId: asCorrelation(),
        providerReference: 'provider-a',
      },
      operationContext(),
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.mode).toBe('voice');
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
    expect(names).toContain('createVoiceResolutionGateway');
    const profile = validateVoiceProfile(neo());
    expect(profile.valid).toBe(true);
    if (!profile.valid) return;
    expect(
      validateVoiceProviderMatch(profile.profile, rawProvider(), {
        policyVersion: 'voice-policy@1',
        now: new Date(),
        ttlMs: 60_000,
      }).ok,
    ).toBe(false);
  });
});
