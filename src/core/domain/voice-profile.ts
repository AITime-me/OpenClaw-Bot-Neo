export const VOICE_PROFILE_SCHEMA_VERSION = '1.0' as const;

export const GENDER_PRESENTATIONS = Object.freeze(['masculine', 'feminine', 'neutral'] as const);
export type GenderPresentation = (typeof GENDER_PRESENTATIONS)[number];

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
  | 'PROVIDER_SPECIFIC_SELECTOR';

export type VoiceAvailabilityDecision =
  | { readonly mode: 'voice'; readonly selector: LogicalVoiceSelector }
  | { readonly mode: 'text-only'; readonly reason: string };
