import type {
  ExtensionRegistryEntryData,
  ExtensionActivationState,
} from './extension-registry-entry.js';
import type { VerifiedExtensionManifest } from './extension-manifest.internal.js';

export const sealedExtensionRegistryEntryBrand: unique symbol = Symbol(
  'SealedExtensionRegistryEntry',
);
export const activeExtensionRegistrationBrand: unique symbol = Symbol(
  'ActiveExtensionRegistration',
);
export const trustedActivationDecisionBrand: unique symbol = Symbol('TrustedActivationDecision');

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
  readonly effectiveRiskClass: ExtensionRegistryEntryData['effectiveRiskClass'];
}

export interface TrustedActivationDecision {
  readonly [trustedActivationDecisionBrand]: true;
  readonly extensionId: string;
  readonly version: string;
  readonly targetState: ExtensionActivationState;
  readonly policyVersion: string;
  readonly deploymentAuthorized: true;
  readonly decidedAt: string;
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

export const sealActiveExtensionRegistration = (
  entry: SealedExtensionRegistryEntry,
): ActiveExtensionRegistration | null => {
  if (entry.activationState !== 'active') return null;
  const sealed = {
    extensionId: entry.extensionId,
    version: entry.version,
    manifest: entry.manifest,
    activationState: 'active' as const,
    policyVersion: entry.policyVersion,
    effectiveRiskClass: entry.effectiveRiskClass,
    [activeExtensionRegistrationBrand]: true as const,
  };
  freezeRecord(sealed);
  return sealed;
};

export const sealTrustedActivationDecision = (input: {
  readonly extensionId: string;
  readonly version: string;
  readonly targetState: ExtensionActivationState;
  readonly policyVersion: string;
  readonly decidedAt: string;
}): TrustedActivationDecision => {
  const sealed = {
    extensionId: input.extensionId,
    version: input.version,
    targetState: input.targetState,
    policyVersion: input.policyVersion,
    deploymentAuthorized: true as const,
    decidedAt: input.decidedAt,
    [trustedActivationDecisionBrand]: true as const,
  };
  freezeRecord(sealed);
  return sealed;
};
