import {
  iso8601FromDate,
  ok,
  parseCorrelationId,
  type CorrelationId,
  type OperationContext,
  type Result,
} from '../domain/index.js';
import {
  exactPlainObservation,
  exactStringArray,
  filledString,
  isFreshWindow,
  parseIsoInstant,
} from '../domain/observation-validation.js';
import {
  isValidatedVoiceProfile,
  sealVerifiedVoiceProviderMatch,
  type ValidatedVoiceProfile,
  type VerifiedVoiceProviderMatch,
} from '../domain/voice-profile.internal.js';
import type { LogicalVoiceSelector } from '../domain/voice-profile.js';
import { GENDER_PRESENTATIONS } from '../domain/voice-profile.js';
import type { ClockPort } from '../ports/index.js';
import type {
  CurrentVoicePolicyPort,
  VoiceProviderConfiguration,
  VoiceProviderConfigurationPort,
  VoiceProviderObservation,
  VoiceProviderObservationPort,
} from '../ports/trusted-derivation.port.js';
import { scanSensitiveMetadata } from '../policy/sensitive-data-scanner.js';

export interface VoiceResolutionGatewayDeps {
  readonly provider: VoiceProviderObservationPort;
  readonly configuration: VoiceProviderConfigurationPort;
  readonly policy: CurrentVoicePolicyPort;
  readonly clock: ClockPort;
}

export interface VoiceResolutionRequest {
  readonly profile: ValidatedVoiceProfile;
  readonly selector: LogicalVoiceSelector;
  readonly correlationId: CorrelationId;
  readonly providerReference: string;
}

export type VoiceResolutionOutcome =
  | { readonly mode: 'voice'; readonly evidence: VerifiedVoiceProviderMatch }
  | { readonly mode: 'text-only'; readonly reason: string };

export interface VoiceResolutionGateway {
  resolve(
    request: VoiceResolutionRequest,
    context: OperationContext,
  ): Promise<Result<VoiceResolutionOutcome, { readonly code: string; readonly reason: string }>>;
}

const OBS_FIELDS = Object.freeze([
  'providerIdentity',
  'providerVoiceReference',
  'observedLanguage',
  'observedGenderPresentation',
  'metadataSourceReference',
  'claimsClonedVoice',
  'claimsIdentityImitation',
  'claimsActorOrCelebrityIdentity',
  'providerConfigurationRevision',
  'correlationId',
  'observedAt',
  'expiresAt',
] as const);

const CONFIG_FIELDS = Object.freeze([
  'providerIdentity',
  'expectedVoiceReference',
  'configurationRevision',
  'language',
  'genderPresentation',
  'metadataSourceReference',
  'allowClonedVoice',
  'allowIdentityImitation',
  'allowActorOrCelebrityIdentity',
  'policyVersion',
  'issuedAt',
  'expiresAt',
] as const);

const POLICY_FIELDS = Object.freeze([
  'policyVersion',
  'evidenceTtlMs',
  'issuedAt',
  'expiresAt',
] as const);
const SELECTOR_FIELDS = Object.freeze(['language', 'genderPresentation', 'styleTags'] as const);

const isGender = (value: unknown): value is (typeof GENDER_PRESENTATIONS)[number] =>
  typeof value === 'string' && (GENDER_PRESENTATIONS as readonly string[]).includes(value);

const sameTags = (left: readonly string[], right: readonly string[]): boolean => {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((value, index) => value === b[index]);
};

export const parseVoiceProviderObservation = (
  observation: unknown,
  expected: { readonly correlationId: string },
  now: Date,
): VoiceProviderObservation | null => {
  const plain = exactPlainObservation(observation, OBS_FIELDS);
  if (plain === null) return null;
  if (
    !filledString(plain.providerIdentity) ||
    !filledString(plain.providerVoiceReference) ||
    !filledString(plain.observedLanguage) ||
    !isGender(plain.observedGenderPresentation) ||
    !filledString(plain.metadataSourceReference) ||
    typeof plain.claimsClonedVoice !== 'boolean' ||
    typeof plain.claimsIdentityImitation !== 'boolean' ||
    typeof plain.claimsActorOrCelebrityIdentity !== 'boolean' ||
    !filledString(plain.providerConfigurationRevision) ||
    !filledString(plain.correlationId)
  )
    return null;
  if (plain.correlationId !== expected.correlationId) return null;
  const observedAt = parseIsoInstant(plain.observedAt);
  const expiresAt = parseIsoInstant(plain.expiresAt);
  if (observedAt === null || expiresAt === null || !isFreshWindow(observedAt, expiresAt, now))
    return null;
  return Object.freeze({
    providerIdentity: plain.providerIdentity,
    providerVoiceReference: plain.providerVoiceReference,
    observedLanguage: plain.observedLanguage,
    observedGenderPresentation: plain.observedGenderPresentation,
    metadataSourceReference: plain.metadataSourceReference,
    claimsClonedVoice: plain.claimsClonedVoice,
    claimsIdentityImitation: plain.claimsIdentityImitation,
    claimsActorOrCelebrityIdentity: plain.claimsActorOrCelebrityIdentity,
    providerConfigurationRevision: plain.providerConfigurationRevision,
    correlationId: plain.correlationId,
    observedAt: plain.observedAt as string,
    expiresAt: plain.expiresAt as string,
  });
};

export const parseVoiceProviderConfiguration = (
  configuration: unknown,
  now: Date,
): VoiceProviderConfiguration | null => {
  const plain = exactPlainObservation(configuration, CONFIG_FIELDS);
  if (plain === null) return null;
  if (
    !filledString(plain.providerIdentity) ||
    !filledString(plain.expectedVoiceReference) ||
    !filledString(plain.configurationRevision) ||
    !filledString(plain.language) ||
    !isGender(plain.genderPresentation) ||
    !filledString(plain.metadataSourceReference) ||
    plain.allowClonedVoice !== false ||
    plain.allowIdentityImitation !== false ||
    plain.allowActorOrCelebrityIdentity !== false ||
    !filledString(plain.policyVersion)
  )
    return null;
  const issuedAt = parseIsoInstant(plain.issuedAt);
  const expiresAt = parseIsoInstant(plain.expiresAt);
  if (issuedAt === null || expiresAt === null || !isFreshWindow(issuedAt, expiresAt, now))
    return null;
  return Object.freeze({
    providerIdentity: plain.providerIdentity,
    expectedVoiceReference: plain.expectedVoiceReference,
    configurationRevision: plain.configurationRevision,
    language: plain.language,
    genderPresentation: plain.genderPresentation,
    metadataSourceReference: plain.metadataSourceReference,
    allowClonedVoice: false,
    allowIdentityImitation: false,
    allowActorOrCelebrityIdentity: false,
    policyVersion: plain.policyVersion,
    issuedAt: plain.issuedAt as string,
    expiresAt: plain.expiresAt as string,
  });
};

const textOnly = (reason: string): Result<VoiceResolutionOutcome, never> =>
  ok({ mode: 'text-only', reason });

/**
 * Trusted voice resolution. Provider adapter returns untrusted observations; core derives
 * safety facts against trusted configuration. Uncertainty always yields text-only.
 */
export function createVoiceResolutionGateway(
  deps: VoiceResolutionGatewayDeps,
): VoiceResolutionGateway {
  return {
    async resolve(request, context) {
      const profile = request.profile;
      if (!isValidatedVoiceProfile(profile))
        return textOnly('Validated voice profile evidence is required.');
      if (!profile.enabled) return textOnly('Voice profile is disabled.');

      const selectorPlain = exactPlainObservation(request.selector, SELECTOR_FIELDS);
      const styleTags = selectorPlain === null ? null : exactStringArray(selectorPlain.styleTags);
      if (
        selectorPlain === null ||
        !filledString(selectorPlain.language) ||
        !isGender(selectorPlain.genderPresentation) ||
        styleTags === null ||
        selectorPlain.language !== profile.primaryVoiceSelector.language ||
        selectorPlain.genderPresentation !== profile.primaryVoiceSelector.genderPresentation ||
        !sameTags(styleTags, profile.primaryVoiceSelector.styleTags)
      )
        return textOnly('Selector mismatch.');
      const selector = profile.primaryVoiceSelector;

      const parsedCorrelationId = parseCorrelationId(request.correlationId);
      if (!parsedCorrelationId.ok) return textOnly('Correlation identity is invalid.');
      const correlationId = parsedCorrelationId.value;
      const providerReference = request.providerReference;
      if (!filledString(providerReference)) return textOnly('Provider reference is invalid.');

      const now = deps.clock.now();
      const policyResult = await deps.policy.currentPolicy(
        { profileId: profile.id, correlationId },
        context,
      );
      if (!policyResult.ok) return textOnly('Voice policy unavailable.');
      const policyPlain = exactPlainObservation(policyResult.value, POLICY_FIELDS);
      if (policyPlain === null) return textOnly('Voice policy observation malformed.');
      if (
        !filledString(policyPlain.policyVersion) ||
        !Number.isSafeInteger(policyPlain.evidenceTtlMs) ||
        (policyPlain.evidenceTtlMs as number) <= 0 ||
        (policyPlain.evidenceTtlMs as number) > 3_600_000
      )
        return textOnly('Voice policy observation invalid.');
      const policyIssued = parseIsoInstant(policyPlain.issuedAt);
      const policyExpires = parseIsoInstant(policyPlain.expiresAt);
      if (
        policyIssued === null ||
        policyExpires === null ||
        !isFreshWindow(policyIssued, policyExpires, now)
      )
        return textOnly('Voice policy is stale.');

      const configResult = await deps.configuration.currentConfiguration(
        {
          profileId: profile.id,
          providerReference,
          selector,
        },
        context,
      );
      if (!configResult.ok) return textOnly('Provider configuration unavailable.');
      const configuration = parseVoiceProviderConfiguration(configResult.value, now);
      if (configuration === null) return textOnly('Provider configuration rejected.');
      if (configuration.policyVersion !== policyPlain.policyVersion)
        return textOnly('Provider configuration policy mismatch.');

      const observationResult = await deps.provider.observe(
        {
          profileId: profile.id,
          correlationId,
          providerReference,
          selector,
        },
        context,
      );
      if (!observationResult.ok) return textOnly('Provider observation unavailable.');
      const observation = parseVoiceProviderObservation(
        observationResult.value,
        { correlationId },
        now,
      );
      if (observation === null) return textOnly('Provider observation rejected.');

      if (observation.providerIdentity !== configuration.providerIdentity)
        return textOnly('Provider identity mismatch.');
      if (observation.providerConfigurationRevision !== configuration.configurationRevision)
        return textOnly('Provider configuration revision mismatch.');
      if (observation.providerVoiceReference !== configuration.expectedVoiceReference)
        return textOnly('Provider voice reference mismatch.');
      if (observation.metadataSourceReference !== configuration.metadataSourceReference)
        return textOnly('Metadata source mismatch.');
      if (observation.observedLanguage !== configuration.language)
        return textOnly('Provider language mismatch.');
      if (observation.observedGenderPresentation !== configuration.genderPresentation)
        return textOnly('Provider gender mismatch.');
      if (observation.observedLanguage !== profile.language)
        return textOnly('Profile language mismatch.');
      if (observation.observedGenderPresentation !== profile.genderPresentation)
        return textOnly('Profile gender mismatch.');
      if (profile.id === 'neo' && observation.observedLanguage !== 'ru-RU')
        return textOnly('Neo requires ru-RU.');
      if (profile.id === 'neo' && observation.observedGenderPresentation !== 'masculine')
        return textOnly('Neo requires masculine presentation.');
      if (observation.claimsClonedVoice) return textOnly('Cloned voice forbidden.');
      if (observation.claimsIdentityImitation) return textOnly('Identity imitation forbidden.');
      if (observation.claimsActorOrCelebrityIdentity)
        return textOnly('Actor or celebrity association forbidden.');

      let providerScan;
      try {
        providerScan = scanSensitiveMetadata({
          providerVoiceReference: observation.providerVoiceReference,
          language: observation.observedLanguage,
          genderPresentation: observation.observedGenderPresentation,
          policyVersion: configuration.policyVersion,
        });
      } catch {
        return textOnly('Provider metadata sensitive-data scan failed.');
      }
      if (!providerScan.ok || providerScan.value.decision !== 'allow')
        return textOnly('Provider metadata sensitive-data scan denied.');

      const validatedAt = iso8601FromDate(now);
      const expiresAt = iso8601FromDate(
        new Date(now.getTime() + (policyPlain.evidenceTtlMs as number)),
      );
      const evidence = sealVerifiedVoiceProviderMatch({
        profileId: profile.id,
        profileSchemaVersion: profile.schemaVersion,
        selector,
        providerVoiceReference: observation.providerVoiceReference,
        language: observation.observedLanguage,
        genderPresentation: observation.observedGenderPresentation,
        policyVersion: configuration.policyVersion,
        validatedAt,
        expiresAt,
      });
      return ok({ mode: 'voice', evidence });
    },
  };
}
