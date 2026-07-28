import type {
  GenderPresentation,
  LogicalVoiceSelector,
  VoiceProfile,
  VoiceProviderMetadataResult,
} from './voice-profile.js';
import type { ISO8601 } from './identity.js';
import { deepFreeze } from './immutable.js';

export type ValidatedVoiceProfile = VoiceProfile;

export interface VerifiedVoiceProviderMatch {
  readonly profileId: string;
  readonly profileSchemaVersion: string;
  readonly selector: LogicalVoiceSelector;
  readonly providerVoiceReference: string;
  readonly language: string;
  readonly genderPresentation: GenderPresentation;
  readonly compatibleWithSelector: true;
  readonly actorOrCelebrityIdentity: false;
  readonly clonedVoice: false;
  readonly identityImitation: false;
  readonly metadataVerified: true;
  readonly policyVersion: string;
  readonly validatedAt: ISO8601;
  readonly expiresAt: ISO8601;
}

const validatedVoiceRegistry = new WeakMap<object, ValidatedVoiceProfile>();
const verifiedProviderRegistry = new WeakMap<object, VerifiedVoiceProviderMatch>();

/** Internal factory; only the deterministic voice validator may create this nominal type. */
export const sealValidatedVoiceProfile = (profile: VoiceProfile): ValidatedVoiceProfile => {
  const sealed = deepFreeze({
    ...profile,
    styleTags: Object.freeze([...profile.styleTags]),
    primaryVoiceSelector: deepFreeze({
      ...profile.primaryVoiceSelector,
      styleTags: Object.freeze([...profile.primaryVoiceSelector.styleTags]),
    }),
    fallbackVoiceSelectors: Object.freeze(
      profile.fallbackVoiceSelectors.map((selector) =>
        deepFreeze({
          ...selector,
          styleTags: Object.freeze([...selector.styleTags]),
        }),
      ),
    ),
  });
  validatedVoiceRegistry.set(sealed, sealed);
  return sealed;
};

export const isValidatedVoiceProfile = (value: unknown): value is ValidatedVoiceProfile =>
  typeof value === 'object' && value !== null && validatedVoiceRegistry.has(value);

export const sealVerifiedVoiceProviderMatch = (input: {
  readonly profileId: string;
  readonly profileSchemaVersion: string;
  readonly selector: LogicalVoiceSelector;
  readonly providerVoiceReference: string;
  readonly language: string;
  readonly genderPresentation: GenderPresentation;
  readonly policyVersion: string;
  readonly validatedAt: ISO8601;
  readonly expiresAt: ISO8601;
}): VerifiedVoiceProviderMatch => {
  const sealed = deepFreeze({
    profileId: input.profileId,
    profileSchemaVersion: input.profileSchemaVersion,
    selector: deepFreeze({
      ...input.selector,
      styleTags: Object.freeze([...input.selector.styleTags]),
    }),
    providerVoiceReference: input.providerVoiceReference,
    language: input.language,
    genderPresentation: input.genderPresentation,
    compatibleWithSelector: true as const,
    actorOrCelebrityIdentity: false as const,
    clonedVoice: false as const,
    identityImitation: false as const,
    metadataVerified: true as const,
    policyVersion: input.policyVersion,
    validatedAt: input.validatedAt,
    expiresAt: input.expiresAt,
  });
  verifiedProviderRegistry.set(sealed, sealed);
  return sealed;
};

export const isVerifiedVoiceProviderMatch = (value: unknown): value is VerifiedVoiceProviderMatch =>
  typeof value === 'object' && value !== null && verifiedProviderRegistry.has(value);

export type { VoiceProviderMetadataResult };
