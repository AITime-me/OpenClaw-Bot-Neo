import type {
  GenderPresentation,
  LogicalVoiceSelector,
  VoiceProfile,
  VoiceProviderMetadataResult,
} from './voice-profile.js';
import type { ISO8601 } from './identity.js';

export const validatedVoiceProfileBrand: unique symbol = Symbol('ValidatedVoiceProfile');
export const verifiedVoiceProviderMatchBrand: unique symbol = Symbol('VerifiedVoiceProviderMatch');

export interface ValidatedVoiceProfile extends VoiceProfile {
  readonly [validatedVoiceProfileBrand]: true;
}

export interface VerifiedVoiceProviderMatch {
  readonly [verifiedVoiceProviderMatchBrand]: true;
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

/** Internal factory; only the deterministic voice validator may create this nominal type. */
export const sealValidatedVoiceProfile = (profile: VoiceProfile): ValidatedVoiceProfile => {
  const sealed = {
    ...profile,
    styleTags: Object.freeze([...profile.styleTags]),
    primaryVoiceSelector: Object.freeze({
      ...profile.primaryVoiceSelector,
      styleTags: Object.freeze([...profile.primaryVoiceSelector.styleTags]),
    }),
    fallbackVoiceSelectors: Object.freeze(
      profile.fallbackVoiceSelectors.map((selector) =>
        Object.freeze({
          ...selector,
          styleTags: Object.freeze([...selector.styleTags]),
        }),
      ),
    ),
    [validatedVoiceProfileBrand]: true as const,
  };
  return Object.freeze(sealed);
};

const freezeRecord = (value: unknown): void => {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return;
  for (const nested of Object.values(value)) freezeRecord(nested);
  Object.freeze(value);
};

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
  const sealed = {
    profileId: input.profileId,
    profileSchemaVersion: input.profileSchemaVersion,
    selector: Object.freeze({
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
    [verifiedVoiceProviderMatchBrand]: true as const,
  };
  freezeRecord(sealed);
  return sealed;
};

export const isVerifiedVoiceProviderMatch = (value: unknown): value is VerifiedVoiceProviderMatch =>
  typeof value === 'object' && value !== null && verifiedVoiceProviderMatchBrand in value;

export type { VoiceProviderMetadataResult };
