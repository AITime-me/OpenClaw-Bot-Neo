export const VOICE_PROFILE_SCHEMA_VERSION = '1.0' as const;

export const GENDER_PRESENTATIONS = Object.freeze(['masculine', 'feminine', 'neutral'] as const);
export type GenderPresentation = (typeof GENDER_PRESENTATIONS)[number];

export const NEO_VOICE_PROFILE_ID = 'neo' as const;

/** Controlled semantic style tags required for the Neo voice profile. */
export const NEO_REQUIRED_STYLE_TAGS = Object.freeze([
  'calm',
  'intelligent',
  'confident',
  'restrained',
  'slightly-futuristic',
  'good-russian-diction',
  'not-call-center',
  'not-pompous-announcer',
] as const);

export const NEO_FORBIDDEN_STYLE_TAGS = Object.freeze([
  'feminine',
  'cross-gender',
  'celebrity',
  'actor-imitation',
  'identity-imitation',
  'voice-clone',
  'cloned-voice',
] as const);

export interface LogicalVoiceSelector {
  readonly language: string;
  readonly genderPresentation: GenderPresentation;
  readonly styleTags: readonly string[];
}

/**
 * Provider-independent desired voice. It contains no provider, endpoint, API key or concrete
 * provider voice identifier.
 */
export interface VoiceProfile {
  readonly id: string;
  readonly schemaVersion: typeof VOICE_PROFILE_SCHEMA_VERSION;
  readonly language: string;
  readonly genderPresentation: GenderPresentation;
  readonly tone: string;
  readonly pace: 'slow' | 'moderate' | 'fast';
  readonly expressiveness: 'restrained' | 'balanced' | 'expressive';
  readonly styleTags: readonly string[];
  readonly primaryVoiceSelector: LogicalVoiceSelector;
  readonly fallbackVoiceSelectors: readonly LogicalVoiceSelector[];
  readonly fallbackMode: 'text-only' | 'same-gender-only';
  readonly allowCrossGenderFallback: boolean;
  readonly allowVoiceCloning: boolean;
  readonly allowIdentityImitation: boolean;
  readonly enabled: boolean;
}

/**
 * Untrusted raw provider metadata returned by a future TTS adapter.
 * Favorable booleans here are not authorization proof.
 */
export interface VoiceProviderMetadataResult {
  readonly providerVoiceReference: string;
  readonly language: string;
  readonly genderPresentation: GenderPresentation;
  readonly compatibleWithSelector: boolean;
  readonly actorOrCelebrityIdentity: boolean;
  readonly clonedVoice: boolean;
  readonly identityImitation: boolean;
  readonly metadataVerified: boolean;
}

/**
 * @deprecated Structural evidence is not trusted. Use sealed VerifiedVoiceProviderMatch.
 */
export type VoiceProviderMatchEvidence = VoiceProviderMetadataResult;

export type VoiceProfileFailureCode =
  | 'INVALID_PROFILE'
  | 'UNSUPPORTED_SCHEMA_VERSION'
  | 'UNKNOWN_GENDER_PRESENTATION'
  | 'MALFORMED_LANGUAGE'
  | 'MISSING_FALLBACK_POLICY'
  | 'PRIMARY_VOICE_MISMATCH'
  | 'CROSS_GENDER_FALLBACK_FORBIDDEN'
  | 'VOICE_CLONING_FORBIDDEN'
  | 'IDENTITY_IMITATION_FORBIDDEN'
  | 'PROVIDER_SPECIFIC_SELECTOR'
  | 'NEO_LANGUAGE_REQUIRED'
  | 'NEO_MASCULINE_REQUIRED'
  | 'NEO_FALLBACK_REQUIRED'
  | 'NEO_STYLE_TAG_REQUIRED'
  | 'NEO_FORBIDDEN_STYLE_TAG'
  | 'NEO_ENABLED_REQUIRED'
  | 'NEO_IDENTITY_FORBIDDEN';

export type VoiceAvailabilityDecision =
  | { readonly mode: 'voice'; readonly selector: LogicalVoiceSelector }
  | { readonly mode: 'text-only'; readonly reason: string };
