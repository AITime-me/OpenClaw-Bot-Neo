import type {
  ExtensionRegistryEntryData,
  ExtensionActivationState,
} from './extension-registry-entry.js';
import type { VerifiedExtensionManifest } from './extension-manifest.internal.js';
import type { ExtensionRiskClass } from './extension-risk.js';
import type { ISO8601 } from './identity.js';

export const sealedExtensionRegistryEntryBrand: unique symbol = Symbol(
  'SealedExtensionRegistryEntry',
);
export const activeExtensionRegistrationBrand: unique symbol = Symbol(
  'ActiveExtensionRegistration',
);
export const trustedActivationDecisionBrand: unique symbol = Symbol('TrustedActivationDecision');
export const deploymentAuthorizationBrand: unique symbol = Symbol(
  'DeploymentAuthorizationEvidence',
);

export interface SealedExtensionRegistryEntry extends ExtensionRegistryEntryData {
  readonly [sealedExtensionRegistryEntryBrand]: true;
}

/** Sealed proof that a specific id/version is active for permission resolution. */
export interface ActiveExtensionRegistration {
  readonly [activeExtensionRegistrationBrand]: true;
  readonly extensionId: string;
  readonly version: string;
  readonly manifest: VerifiedExtensionManifest;
  readonly activationState: 'active';
  readonly policyVersion: string;
  readonly effectiveRiskClass: ExtensionRiskClass;
  readonly manifestDigest: string;
}

export interface DeploymentAuthorizationEvidence {
  readonly [deploymentAuthorizationBrand]: true;
  readonly deploymentIdentity: string;
  readonly extensionId: string;
  readonly extensionVersion: string;
  readonly manifestDigest: string;
  readonly policyVersion: string;
  readonly authorizationScope: 'activate';
  readonly issuedAt: ISO8601;
  readonly expiresAt: ISO8601;
  readonly provenance: 'trusted-deployment';
}

export interface TrustedActivationDecision {
  readonly [trustedActivationDecisionBrand]: true;
  readonly extensionId: string;
  readonly version: string;
  readonly targetState: ExtensionActivationState;
  readonly expectedPreviousState: ExtensionActivationState;
  readonly policyVersion: string;
  readonly manifestDigest: string;
  readonly effectiveRiskClass: ExtensionRiskClass;
  readonly deploymentAuthorization: DeploymentAuthorizationEvidence;
  readonly decidedAt: ISO8601;
  readonly expiresAt: ISO8601;
  readonly nonce: string;
}

const freezeRecord = (value: unknown): void => {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return;
  for (const nested of Object.values(value)) freezeRecord(nested);
  Object.freeze(value);
};

export const sealExtensionRegistryEntry = (
  entry: ExtensionRegistryEntryData,
): SealedExtensionRegistryEntry => {
  const sealed = {
    ...entry,
    grantedCapabilityRefs: [...entry.grantedCapabilityRefs],
    grantedPermissionRefs: [...entry.grantedPermissionRefs],
    provenance: { ...entry.provenance },
    [sealedExtensionRegistryEntryBrand]: true as const,
  };
  freezeRecord(sealed);
  return sealed;
};

export const isSealedExtensionRegistryEntry = (
  value: unknown,
): value is SealedExtensionRegistryEntry =>
  typeof value === 'object' && value !== null && sealedExtensionRegistryEntryBrand in value;

/**
 * Creates active registration evidence only from a sealed registry entry that is already active.
 * Callers outside the trusted activation/registry transition must not use this.
 */
export const sealActiveExtensionRegistration = (
  entry: SealedExtensionRegistryEntry,
  manifestDigest: string,
): ActiveExtensionRegistration | null => {
  if (!isSealedExtensionRegistryEntry(entry)) return null;
  if (entry.activationState !== 'active') return null;
  if (typeof manifestDigest !== 'string' || manifestDigest.length === 0) return null;
  const sealed = {
    extensionId: entry.extensionId,
    version: entry.version,
    manifest: entry.manifest,
    activationState: 'active' as const,
    policyVersion: entry.policyVersion,
    effectiveRiskClass: entry.effectiveRiskClass,
    manifestDigest,
    [activeExtensionRegistrationBrand]: true as const,
  };
  freezeRecord(sealed);
  return sealed;
};

export const sealDeploymentAuthorization = (input: {
  readonly deploymentIdentity: string;
  readonly extensionId: string;
  readonly extensionVersion: string;
  readonly manifestDigest: string;
  readonly policyVersion: string;
  readonly issuedAt: ISO8601;
  readonly expiresAt: ISO8601;
}): DeploymentAuthorizationEvidence => {
  const sealed = {
    ...input,
    authorizationScope: 'activate' as const,
    provenance: 'trusted-deployment' as const,
    [deploymentAuthorizationBrand]: true as const,
  };
  freezeRecord(sealed);
  return sealed;
};

export const isDeploymentAuthorizationEvidence = (
  value: unknown,
): value is DeploymentAuthorizationEvidence =>
  typeof value === 'object' && value !== null && deploymentAuthorizationBrand in value;

export const sealTrustedActivationDecision = (input: {
  readonly extensionId: string;
  readonly version: string;
  readonly targetState: ExtensionActivationState;
  readonly expectedPreviousState: ExtensionActivationState;
  readonly policyVersion: string;
  readonly manifestDigest: string;
  readonly effectiveRiskClass: ExtensionRiskClass;
  readonly deploymentAuthorization: DeploymentAuthorizationEvidence;
  readonly decidedAt: ISO8601;
  readonly expiresAt: ISO8601;
  readonly nonce: string;
}): TrustedActivationDecision | null => {
  if (!isDeploymentAuthorizationEvidence(input.deploymentAuthorization)) return null;
  const sealed = {
    ...input,
    [trustedActivationDecisionBrand]: true as const,
  };
  freezeRecord(sealed);
  return sealed;
};

export const isTrustedActivationDecision = (value: unknown): value is TrustedActivationDecision =>
  typeof value === 'object' && value !== null && trustedActivationDecisionBrand in value;

export const isActiveExtensionRegistration = (
  value: unknown,
): value is ActiveExtensionRegistration =>
  typeof value === 'object' && value !== null && activeExtensionRegistrationBrand in value;
