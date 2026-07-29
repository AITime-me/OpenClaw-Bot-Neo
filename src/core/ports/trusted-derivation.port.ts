import type { ExtensionPermission } from '../domain/extension-manifest.js';
import type { ExtensionRiskClass } from '../domain/extension-risk.js';
import type { SourceTrustClassification } from '../domain/extension-runtime-risk.js';
import type { CorrelationId, ISO8601 } from '../domain/identity.js';
import type { OperationContext, Result } from '../domain/index.js';
import type { GenderPresentation, LogicalVoiceSelector } from '../domain/voice-profile.js';

export type ObservationPortFailure = {
  readonly code: string;
  readonly reason: string;
};

/** Untrusted routing observation — favorable values are not proof. */
export interface RoutingObservation {
  readonly extensionId: string;
  readonly extensionVersion: string;
  readonly correlationId: string;
  readonly sourceTrust: SourceTrustClassification;
  readonly routingRiskFloor: ExtensionRiskClass;
  readonly sourceReference: string;
  readonly channelId: string;
  readonly sessionId: string;
  readonly observedAt: string;
  readonly expiresAt: string;
}

export interface TrustedRoutingObservationPort {
  observe(
    request: {
      readonly extensionId: string;
      readonly extensionVersion: string;
      readonly correlationId: CorrelationId;
      readonly operationCategory: string;
      readonly sourceReference: string;
    },
    context: OperationContext,
  ): Promise<Result<RoutingObservation, ObservationPortFailure>>;
}

/** Untrusted Security Guard decision observation. */
export interface SecurityGuardObservation {
  readonly extensionId: string;
  readonly extensionVersion: string;
  readonly correlationId: string;
  readonly securityGuardFloor: ExtensionRiskClass;
  readonly denied: boolean;
  readonly allowedPermissions: readonly ExtensionPermission[];
  readonly observedAt: string;
  readonly expiresAt: string;
}

export interface SecurityGuardDecisionPort {
  decide(
    request: {
      readonly extensionId: string;
      readonly extensionVersion: string;
      readonly correlationId: CorrelationId;
      readonly operationCategory: string;
    },
    context: OperationContext,
  ): Promise<Result<SecurityGuardObservation, ObservationPortFailure>>;
}

/** Untrusted current policy observation including grant sets. */
export interface CurrentExtensionPolicyObservation {
  readonly extensionId: string;
  readonly extensionVersion: string;
  readonly policyVersion: string;
  readonly riskPolicyVersion: string;
  readonly deploymentAllowed: readonly ExtensionPermission[];
  readonly roleAllowed: readonly ExtensionPermission[];
  readonly securityAllowed: readonly ExtensionPermission[];
  readonly riskAllowed: readonly ExtensionPermission[];
  readonly deploymentAuthorizationTtlMs: number;
  readonly runtimeEvidenceTtlMs: number;
  readonly voiceEvidenceTtlMs: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface CurrentExtensionPolicyPort {
  currentPolicy(
    request: {
      readonly extensionId: string;
      readonly extensionVersion: string;
      readonly correlationId: CorrelationId;
    },
    context: OperationContext,
  ): Promise<Result<CurrentExtensionPolicyObservation, ObservationPortFailure>>;
}

/** Untrusted authenticated deployment/owner approval observation. */
export interface DeploymentApprovalObservation {
  readonly deploymentIdentity: string;
  readonly ownerId: string;
  readonly actorId: string;
  readonly sessionId: string;
  readonly channelId: string;
  readonly extensionId: string;
  readonly extensionVersion: string;
  readonly authorizationScope: 'activate';
  readonly correlationId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface AuthenticatedDeploymentApprovalPort {
  observe(
    rawAuthorizationMaterial: unknown,
    request: {
      readonly extensionId: string;
      readonly extensionVersion: string;
      readonly correlationId: CorrelationId;
      readonly requestedAction: 'activate';
    },
    context: OperationContext,
  ): Promise<Result<DeploymentApprovalObservation, ObservationPortFailure>>;
}

/** Untrusted voice provider observation — booleans are claims, not proof. */
export interface VoiceProviderObservation {
  readonly providerIdentity: string;
  readonly providerVoiceReference: string;
  readonly observedLanguage: string;
  readonly observedGenderPresentation: GenderPresentation;
  readonly metadataSourceReference: string;
  readonly claimsClonedVoice: boolean;
  readonly claimsIdentityImitation: boolean;
  readonly claimsActorOrCelebrityIdentity: boolean;
  readonly providerConfigurationRevision: string;
  readonly correlationId: string;
  readonly observedAt: string;
  readonly expiresAt: string;
}

export interface VoiceProviderObservationPort {
  observe(
    request: {
      readonly profileId: string;
      readonly correlationId: CorrelationId;
      readonly providerReference: string;
      readonly selector: LogicalVoiceSelector;
    },
    context: OperationContext,
  ): Promise<Result<VoiceProviderObservation, ObservationPortFailure>>;
}

export interface VoiceProviderConfiguration {
  readonly providerIdentity: string;
  readonly expectedVoiceReference: string;
  readonly configurationRevision: string;
  readonly language: string;
  readonly genderPresentation: GenderPresentation;
  readonly metadataSourceReference: string;
  readonly allowClonedVoice: false;
  readonly allowIdentityImitation: false;
  readonly allowActorOrCelebrityIdentity: false;
  readonly policyVersion: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface VoiceProviderConfigurationPort {
  currentConfiguration(
    request: {
      readonly profileId: string;
      readonly providerReference: string;
      readonly selector: LogicalVoiceSelector;
    },
    context: OperationContext,
  ): Promise<Result<VoiceProviderConfiguration, ObservationPortFailure>>;
}

export interface CurrentVoicePolicyObservation {
  readonly policyVersion: string;
  readonly evidenceTtlMs: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface CurrentVoicePolicyPort {
  currentPolicy(
    request: { readonly profileId: string; readonly correlationId: CorrelationId },
    context: OperationContext,
  ): Promise<Result<CurrentVoicePolicyObservation, ObservationPortFailure>>;
}

export type { ISO8601 };
