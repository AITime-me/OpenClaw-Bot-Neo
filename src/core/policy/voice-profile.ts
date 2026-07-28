import {
  GENDER_PRESENTATIONS,
  VOICE_PROFILE_SCHEMA_VERSION,
  type GenderPresentation,
  type LogicalVoiceSelector,
  type ValidatedVoiceProfile,
  type VoiceAvailabilityDecision,
  type VoiceProfile,
  type VoiceProfileFailureCode,
} from '../domain/index.js';
import { sealValidatedVoiceProfile } from '../domain/voice-profile.internal.js';

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
] as const);

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
  return {
    selector: {
      language: value.language,
      genderPresentation: value.genderPresentation,
      styleTags: Object.freeze([...value.styleTags]),
    },
  };
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
): VoiceAvailabilityDecision {
  if (primaryAvailable) return { mode: 'voice', selector: profile.primaryVoiceSelector };
  if (profile.fallbackMode === 'same-gender-only')
    for (const index of availableFallbackIndexes) {
      const selector = profile.fallbackVoiceSelectors[index];
      if (selector !== undefined && selector.genderPresentation === profile.genderPresentation)
        return { mode: 'voice', selector };
    }
  return { mode: 'text-only', reason: 'No policy-compatible voice is available.' };
}
