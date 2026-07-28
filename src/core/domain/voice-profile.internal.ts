import type { VoiceProfile } from './voice-profile.js';

export const validatedVoiceProfileBrand: unique symbol = Symbol('ValidatedVoiceProfile');

export interface ValidatedVoiceProfile extends VoiceProfile {
  readonly [validatedVoiceProfileBrand]: true;
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
