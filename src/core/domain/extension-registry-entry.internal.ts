import type {
  ExtensionRegistryEntryData,
  ExtensionActivationState,
} from './extension-registry-entry.js';
import type { VerifiedExtensionManifest } from './extension-manifest.internal.js';
import { isVerifiedExtensionManifest } from './extension-manifest.internal.js';
import type { ExtensionRiskClass } from './extension-risk.js';
import type { ISO8601 } from './identity.js';
import { deepFreeze } from './immutable.js';

export type SealedExtensionRegistryEntry = ExtensionRegistryEntryData;

/** Sealed proof that a specific id/version is active for permission resolution. */
export interface ActiveExtensionRegistration {
  readonly extensionId: string;
  readonly version: string;
  readonly manifest: VerifiedExtensionManifest;
  readonly activationState: 'active';
  readonly policyVersion: string;
  readonly effectiveRiskClass: ExtensionRiskClass;
  readonly manifestDigest: string;
}

export interface DeploymentAuthorizationEvidence {
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

const sealedEntryRegistry = new WeakMap<object, SealedExtensionRegistryEntry>();
const activeRegistrationRegistry = new WeakMap<object, ActiveExtensionRegistration>();
const deploymentAuthorizationRegistry = new WeakMap<object, DeploymentAuthorizationEvidence>();
const trustedActivationRegistry = new WeakMap<object, TrustedActivationDecision>();

export const sealExtensionRegistryEntry = (
  entry: ExtensionRegistryEntryData,
): SealedExtensionRegistryEntry => {
  const sealed = deepFreeze({
    ...entry,
    grantedCapabilityRefs: Object.freeze([...entry.grantedCapabilityRefs]),
    grantedPermissionRefs: Object.freeze([...entry.grantedPermissionRefs]),
    provenance: deepFreeze({ ...entry.provenance }),
  });
  sealedEntryRegistry.set(sealed, sealed);
  return sealed;
};

export const isSealedExtensionRegistryEntry = (
  value: unknown,
): value is SealedExtensionRegistryEntry =>
  typeof value === 'object' && value !== null && sealedEntryRegistry.has(value);

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
  if (!isVerifiedExtensionManifest(entry.manifest)) return null;
  const sealed = deepFreeze({
    extensionId: entry.extensionId,
    version: entry.version,
    manifest: entry.manifest,
    activationState: 'active' as const,
    policyVersion: entry.policyVersion,
    effectiveRiskClass: entry.effectiveRiskClass,
    manifestDigest,
  });
  activeRegistrationRegistry.set(sealed, sealed);
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
  const sealed = deepFreeze({
    ...input,
    authorizationScope: 'activate' as const,
    provenance: 'trusted-deployment' as const,
  });
  deploymentAuthorizationRegistry.set(sealed, sealed);
  return sealed;
};

export const isDeploymentAuthorizationEvidence = (
  value: unknown,
): value is DeploymentAuthorizationEvidence =>
  typeof value === 'object' && value !== null && deploymentAuthorizationRegistry.has(value);

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
  const sealed = deepFreeze({ ...input });
  trustedActivationRegistry.set(sealed, sealed);
  return sealed;
};

export const isTrustedActivationDecision = (value: unknown): value is TrustedActivationDecision =>
  typeof value === 'object' && value !== null && trustedActivationRegistry.has(value);

export const isActiveExtensionRegistration = (
  value: unknown,
): value is ActiveExtensionRegistration =>
  typeof value === 'object' && value !== null && activeRegistrationRegistry.has(value);
