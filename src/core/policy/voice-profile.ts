import {
  GENDER_PRESENTATIONS,
  NEO_FORBIDDEN_STYLE_TAGS,
  NEO_REQUIRED_STYLE_TAGS,
  NEO_VOICE_PROFILE_ID,
  VOICE_PROFILE_SCHEMA_VERSION,
  type GenderPresentation,
  type LogicalVoiceSelector,
  type ValidatedVoiceProfile,
  type VoiceAvailabilityDecision,
  type VoiceProfile,
  type VoiceProfileFailureCode,
} from '../domain/index.js';
import {
  isVerifiedVoiceProviderMatch,
  sealValidatedVoiceProfile,
  sealVerifiedVoiceProviderMatch,
  type VerifiedVoiceProviderMatch,
} from '../domain/voice-profile.internal.js';
import type { ISO8601 } from '../domain/identity.js';

export type VoiceProfileValidation =
  | { readonly valid: true; readonly profile: ValidatedVoiceProfile }
  | {
      readonly valid: false;
      readonly code: VoiceProfileFailureCode;
      readonly reason: string;
    };

const PROFILE_FIELDS = Object.freeze([
  'id',
  'schemaVersion',
  'language',
  'genderPresentation',
  'tone',
  'pace',
  'expressiveness',
  'styleTags',
  'primaryVoiceSelector',
  'fallbackVoiceSelectors',
  'fallbackMode',
  'allowCrossGenderFallback',
  'allowVoiceCloning',
  'allowIdentityImitation',
  'enabled',
] as const);
const SELECTOR_FIELDS = Object.freeze(['language', 'genderPresentation', 'styleTags'] as const);
const LANGUAGE_PATTERN = /^[a-z]{2,3}-[A-Z]{2}$/;
const PROVIDER_FIELDS = Object.freeze([
  'provider',
  'providerId',
  'voiceId',
  'endpoint',
  'apiKey',
  'model',
  'api_key',
] as const);
const IDENTITY_FRAGMENTS = Object.freeze([
  'celebrity',
  'actor',
  'actress',
  'impersonat',
  'clone-of',
  'voice-id-',
  'https://',
  'http://',
  'sk-',
]);

const invalid = (code: VoiceProfileFailureCode, reason: string): VoiceProfileValidation => ({
  valid: false,
  code,
  reason,
});
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const exact = (value: Record<string, unknown>, fields: readonly string[]): boolean =>
  Object.keys(value).every((key) => fields.some((field) => field === key)) &&
  fields.every((key) => Object.hasOwn(value, key));
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');
const isGender = (value: unknown): value is GenderPresentation =>
  typeof value === 'string' && GENDER_PRESENTATIONS.some((presentation) => presentation === value);

const parseSelector = (
  value: unknown,
): { readonly selector: LogicalVoiceSelector } | VoiceProfileValidation => {
  if (!isRecord(value)) return invalid('INVALID_PROFILE', 'Voice selector must be an object.');
  if (
    Object.keys(value).some((key) => PROVIDER_FIELDS.some((providerField) => providerField === key))
  )
    return invalid(
      'PROVIDER_SPECIFIC_SELECTOR',
      'Provider-specific selector fields are forbidden.',
    );
  if (!exact(value, SELECTOR_FIELDS))
    return invalid('PROVIDER_SPECIFIC_SELECTOR', 'Voice selector contains unsupported fields.');
  if (typeof value.language !== 'string' || !LANGUAGE_PATTERN.test(value.language))
    return invalid('MALFORMED_LANGUAGE', 'Voice selector language is malformed.');
  if (!isGender(value.genderPresentation))
    return invalid('UNKNOWN_GENDER_PRESENTATION', 'Voice selector gender is unknown.');
  if (!isStringArray(value.styleTags))
    return invalid('INVALID_PROFILE', 'Voice selector style tags must be strings.');
  const joined = value.styleTags.join(' ').toLowerCase();
  if (IDENTITY_FRAGMENTS.some((fragment) => joined.includes(fragment)))
    return invalid('NEO_IDENTITY_FORBIDDEN', 'Selector contains identity imitation material.');
  return {
    selector: {
      language: value.language,
      genderPresentation: value.genderPresentation,
      styleTags: Object.freeze([...value.styleTags]),
    },
  };
};

const validateNeoInvariants = (
  candidate: Record<string, unknown>,
): VoiceProfileValidation | null => {
  if (candidate.id !== NEO_VOICE_PROFILE_ID) return null;
  if (candidate.language !== 'ru-RU')
    return invalid('NEO_LANGUAGE_REQUIRED', 'Neo voice profile must use ru-RU.');
  if (candidate.genderPresentation !== 'masculine')
    return invalid('NEO_MASCULINE_REQUIRED', 'Neo voice profile must be masculine.');
  if (candidate.fallbackMode !== 'text-only')
    return invalid('NEO_FALLBACK_REQUIRED', 'Neo fallback must be text-only.');
  if (candidate.allowCrossGenderFallback !== false)
    return invalid('CROSS_GENDER_FALLBACK_FORBIDDEN', 'Neo forbids cross-gender fallback.');
  if (candidate.allowVoiceCloning !== false)
    return invalid('VOICE_CLONING_FORBIDDEN', 'Neo forbids voice cloning.');
  if (candidate.allowIdentityImitation !== false)
    return invalid('IDENTITY_IMITATION_FORBIDDEN', 'Neo forbids identity imitation.');
  if (!isStringArray(candidate.styleTags))
    return invalid('INVALID_PROFILE', 'Neo style tags must be strings.');
  for (const required of NEO_REQUIRED_STYLE_TAGS)
    if (!candidate.styleTags.includes(required))
      return invalid('NEO_STYLE_TAG_REQUIRED', 'Neo profile is missing a required style tag.');
  for (const tag of candidate.styleTags)
    if (NEO_FORBIDDEN_STYLE_TAGS.some((forbidden) => forbidden === tag))
      return invalid('NEO_FORBIDDEN_STYLE_TAG', 'Neo profile contains a forbidden style tag.');
  const searchable = [
    candidate.tone,
    candidate.styleTags.join(' '),
    JSON.stringify(candidate.primaryVoiceSelector),
    JSON.stringify(candidate.fallbackVoiceSelectors),
  ]
    .join(' ')
    .toLowerCase();
  if (
    ['celebrity', 'actor-imitation', 'impersonat', 'clone-of', 'https://', 'http://', 'sk-'].some(
      (fragment) => searchable.includes(fragment),
    )
  )
    return invalid('NEO_IDENTITY_FORBIDDEN', 'Neo profile contains identity or provider material.');
  return null;
};

export function validateVoiceProfile(candidate: unknown): VoiceProfileValidation {
  if (!isRecord(candidate)) return invalid('INVALID_PROFILE', 'Voice profile must be an object.');
  if (!exact(candidate, PROFILE_FIELDS))
    return Object.hasOwn(candidate, 'fallbackMode')
      ? invalid('INVALID_PROFILE', 'Voice profile fields are incomplete or unsupported.')
      : invalid('MISSING_FALLBACK_POLICY', 'Fallback policy is required.');
  if (candidate.schemaVersion !== VOICE_PROFILE_SCHEMA_VERSION)
    return invalid('UNSUPPORTED_SCHEMA_VERSION', 'Voice profile schema is unsupported.');
  if (typeof candidate.language !== 'string' || !LANGUAGE_PATTERN.test(candidate.language))
    return invalid('MALFORMED_LANGUAGE', 'Voice profile language is malformed.');
  if (!isGender(candidate.genderPresentation))
    return invalid('UNKNOWN_GENDER_PRESENTATION', 'Gender presentation is unknown.');
  if (
    typeof candidate.id !== 'string' ||
    candidate.id.length === 0 ||
    typeof candidate.tone !== 'string' ||
    candidate.tone.length === 0 ||
    (candidate.pace !== 'slow' && candidate.pace !== 'moderate' && candidate.pace !== 'fast') ||
    (candidate.expressiveness !== 'restrained' &&
      candidate.expressiveness !== 'balanced' &&
      candidate.expressiveness !== 'expressive') ||
    !isStringArray(candidate.styleTags) ||
    typeof candidate.enabled !== 'boolean'
  )
    return invalid('INVALID_PROFILE', 'Voice profile has malformed fields.');
  if (candidate.fallbackMode !== 'text-only' && candidate.fallbackMode !== 'same-gender-only')
    return invalid('MISSING_FALLBACK_POLICY', 'Fallback policy is unknown.');
  if (
    typeof candidate.allowCrossGenderFallback !== 'boolean' ||
    typeof candidate.allowVoiceCloning !== 'boolean' ||
    typeof candidate.allowIdentityImitation !== 'boolean'
  )
    return invalid('INVALID_PROFILE', 'Voice safety flags must be explicit booleans.');
  if (candidate.allowVoiceCloning)
    return invalid('VOICE_CLONING_FORBIDDEN', 'Voice cloning is forbidden.');
  if (candidate.allowIdentityImitation)
    return invalid('IDENTITY_IMITATION_FORBIDDEN', 'Identity imitation is forbidden.');

  const neoFailure = validateNeoInvariants(candidate);
  if (neoFailure !== null) return neoFailure;

  const primary = parseSelector(candidate.primaryVoiceSelector);
  if (!('selector' in primary)) return primary;
  if (
    primary.selector.language !== candidate.language ||
    primary.selector.genderPresentation !== candidate.genderPresentation
  )
    return invalid('PRIMARY_VOICE_MISMATCH', 'Primary selector must match profile identity.');
  if (!Array.isArray(candidate.fallbackVoiceSelectors))
    return invalid('MISSING_FALLBACK_POLICY', 'Fallback selectors must be explicit.');
  const fallbacks: LogicalVoiceSelector[] = [];
  for (const value of candidate.fallbackVoiceSelectors) {
    const parsed = parseSelector(value);
    if (!('selector' in parsed)) return parsed;
    if (
      parsed.selector.genderPresentation !== candidate.genderPresentation &&
      !candidate.allowCrossGenderFallback
    )
      return invalid(
        'CROSS_GENDER_FALLBACK_FORBIDDEN',
        'Cross-gender voice fallback is forbidden.',
      );
    if (candidate.id === NEO_VOICE_PROFILE_ID && parsed.selector.genderPresentation !== 'masculine')
      return invalid('NEO_MASCULINE_REQUIRED', 'Neo fallback selectors must be masculine.');
    fallbacks.push(parsed.selector);
  }
  if (candidate.allowCrossGenderFallback)
    return invalid(
      'CROSS_GENDER_FALLBACK_FORBIDDEN',
      'Cross-gender fallback cannot be enabled by a profile.',
    );

  const profile: VoiceProfile = {
    id: candidate.id,
    schemaVersion: VOICE_PROFILE_SCHEMA_VERSION,
    language: candidate.language,
    genderPresentation: candidate.genderPresentation,
    tone: candidate.tone,
    pace: candidate.pace,
    expressiveness: candidate.expressiveness,
    styleTags: Object.freeze([...candidate.styleTags]),
    primaryVoiceSelector: Object.freeze(primary.selector),
    fallbackVoiceSelectors: Object.freeze(fallbacks),
    fallbackMode: candidate.fallbackMode,
    allowCrossGenderFallback: false,
    allowVoiceCloning: false,
    allowIdentityImitation: false,
    enabled: candidate.enabled,
  };
  return { valid: true, profile: sealValidatedVoiceProfile(profile) };
}

export function resolveVoiceAvailability(
  profile: ValidatedVoiceProfile,
  primaryAvailable: boolean,
  availableFallbackIndexes: readonly number[] = [],
  providerEvidence: VerifiedVoiceProviderMatch | null = null,
  now: Date = new Date(),
): VoiceAvailabilityDecision {
  if (!profile.enabled) return { mode: 'text-only', reason: 'Voice profile is disabled.' };
  if (!isVerifiedVoiceProviderMatch(providerEvidence))
    return { mode: 'text-only', reason: 'Provider metadata is unverified.' };
  const evidence = providerEvidence;
  const validatedAt = Date.parse(evidence.validatedAt);
  const expiresAt = Date.parse(evidence.expiresAt);
  const current = now.getTime();
  if (
    !Number.isFinite(validatedAt) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= validatedAt ||
    current < validatedAt ||
    current >= expiresAt
  )
    return { mode: 'text-only', reason: 'Provider evidence is stale.' };
  if (evidence.profileId !== profile.id || evidence.profileSchemaVersion !== profile.schemaVersion)
    return { mode: 'text-only', reason: 'Provider evidence does not match the profile.' };
  if (
    evidence.selector.language !== profile.primaryVoiceSelector.language ||
    evidence.selector.genderPresentation !== profile.primaryVoiceSelector.genderPresentation
  )
    return { mode: 'text-only', reason: 'Provider evidence selector mismatch.' };
  if (evidence.language !== profile.language)
    return { mode: 'text-only', reason: 'Provider language does not match the profile.' };
  if (evidence.genderPresentation !== profile.genderPresentation)
    return { mode: 'text-only', reason: 'Provider gender presentation does not match.' };
  if (evidence.genderPresentation !== 'masculine' && profile.id === NEO_VOICE_PROFILE_ID)
    return { mode: 'text-only', reason: 'Provider gender presentation does not match.' };

  if (primaryAvailable) return { mode: 'voice', selector: profile.primaryVoiceSelector };
  if (profile.fallbackMode === 'same-gender-only')
    for (const index of availableFallbackIndexes) {
      const selector = profile.fallbackVoiceSelectors[index];
      if (selector !== undefined && selector.genderPresentation === profile.genderPresentation)
        return { mode: 'voice', selector };
    }
  return { mode: 'text-only', reason: 'No policy-compatible voice is available.' };
}

export type VoiceProviderValidation =
  | { readonly ok: true; readonly evidence: VerifiedVoiceProviderMatch }
  | { readonly ok: false; readonly reason: string };

/**
 * Trusted provider validation boundary. Adapters supply untrusted metadata; only this boundary
 * may create sealed VerifiedVoiceProviderMatch evidence.
 */
export function validateVoiceProviderMatch(
  profile: ValidatedVoiceProfile,
  metadata: unknown,
  options: {
    readonly policyVersion: string;
    readonly now: Date;
    readonly ttlMs: number;
    readonly providerVoiceReference?: string;
  },
): VoiceProviderValidation {
  if (
    typeof metadata !== 'object' ||
    metadata === null ||
    !('providerVoiceReference' in metadata) ||
    !('language' in metadata) ||
    !('genderPresentation' in metadata) ||
    !('compatibleWithSelector' in metadata) ||
    !('actorOrCelebrityIdentity' in metadata) ||
    !('clonedVoice' in metadata) ||
    !('identityImitation' in metadata) ||
    !('metadataVerified' in metadata) ||
    typeof metadata.providerVoiceReference !== 'string' ||
    metadata.providerVoiceReference.length === 0 ||
    typeof metadata.language !== 'string' ||
    typeof metadata.genderPresentation !== 'string' ||
    typeof metadata.compatibleWithSelector !== 'boolean' ||
    typeof metadata.actorOrCelebrityIdentity !== 'boolean' ||
    typeof metadata.clonedVoice !== 'boolean' ||
    typeof metadata.identityImitation !== 'boolean' ||
    typeof metadata.metadataVerified !== 'boolean'
  )
    return { ok: false, reason: 'Provider metadata is malformed.' };
  if (!metadata.metadataVerified) return { ok: false, reason: 'Provider metadata is unverified.' };
  if (!metadata.compatibleWithSelector)
    return { ok: false, reason: 'Provider voice is incompatible with the selector.' };
  if (metadata.actorOrCelebrityIdentity || metadata.identityImitation)
    return { ok: false, reason: 'Identity imitation is forbidden.' };
  if (metadata.clonedVoice) return { ok: false, reason: 'Cloned voices are forbidden.' };
  if (metadata.language !== profile.language)
    return { ok: false, reason: 'Provider language does not match the profile.' };
  if (metadata.genderPresentation !== profile.genderPresentation)
    return { ok: false, reason: 'Provider gender presentation does not match.' };
  if (
    options.providerVoiceReference !== undefined &&
    options.providerVoiceReference !== metadata.providerVoiceReference
  )
    return { ok: false, reason: 'Provider voice reference mismatch.' };
  if (!Number.isSafeInteger(options.ttlMs) || options.ttlMs <= 0)
    return { ok: false, reason: 'Provider evidence TTL is invalid.' };
  if (typeof options.policyVersion !== 'string' || options.policyVersion.length === 0)
    return { ok: false, reason: 'Provider policy version is invalid.' };

  const validatedAt = options.now.toISOString() as ISO8601;
  const expiresAt = new Date(options.now.getTime() + options.ttlMs).toISOString() as ISO8601;
  return {
    ok: true,
    evidence: sealVerifiedVoiceProviderMatch({
      profileId: profile.id,
      profileSchemaVersion: profile.schemaVersion,
      selector: profile.primaryVoiceSelector,
      providerVoiceReference: metadata.providerVoiceReference,
      language: metadata.language,
      genderPresentation: metadata.genderPresentation,
      policyVersion: options.policyVersion,
      validatedAt,
      expiresAt,
    }),
  };
}
