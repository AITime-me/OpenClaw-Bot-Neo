import type { ExtensionPermission, ExtensionProvenance } from './extension-manifest.js';
import type { VerifiedExtensionManifest } from './extension-manifest.internal.js';
import type { ExtensionRiskClass } from './extension-risk.js';
import type { ISO8601 } from './identity.js';

export const EXTENSION_ACTIVATION_STATES = Object.freeze([
  'disabled',
  'pending-policy',
  'active',
  'rejected',
] as const);
export type ExtensionActivationState = (typeof EXTENSION_ACTIVATION_STATES)[number];

export const isExtensionActivationState = (value: unknown): value is ExtensionActivationState =>
  typeof value === 'string' && (EXTENSION_ACTIVATION_STATES as readonly string[]).includes(value);

/**
 * Allowed trusted transitions. Unknown or missing edges deny.
 * rejected → active is forbidden without a new verified registration.
 */
export const EXTENSION_ACTIVATION_TRANSITIONS = Object.freeze({
  disabled: Object.freeze(['disabled'] as const),
  'pending-policy': Object.freeze(['active', 'rejected', 'disabled'] as const),
  active: Object.freeze(['disabled', 'rejected'] as const),
  rejected: Object.freeze(['rejected'] as const),
} as const satisfies Record<ExtensionActivationState, readonly ExtensionActivationState[]>);

export function isAllowedActivationTransition(
  from: ExtensionActivationState,
  to: ExtensionActivationState,
): boolean {
  return EXTENSION_ACTIVATION_TRANSITIONS[from].some((state) => state === to);
}

/**
 * Declarative registry entry fields before sealing. `manifest.enabled` only means the extension
 * may be considered for registration — never that it is active or permission-granted.
 * The sealed factory attaches the verified manifest brand.
 */
export interface ExtensionRegistryEntryData {
  readonly extensionId: string;
  readonly version: string;
  readonly manifest: VerifiedExtensionManifest;
  readonly activationState: ExtensionActivationState;
  readonly registeredAt: ISO8601;
  readonly provenance: ExtensionProvenance;
  readonly policyVersion: string;
  readonly effectiveRiskClass: ExtensionRiskClass;
  /** Safe reference ids only — never treated as granted permissions. */
  readonly grantedCapabilityRefs: readonly string[];
  readonly grantedPermissionRefs: readonly ExtensionPermission[];
  readonly disabledReason: string | null;
  readonly pendingReason: string | null;
}

export type ExtensionRegistryFailureCode =
  | 'INVALID_ENTRY'
  | 'UNKNOWN_ACTIVATION_STATE'
  | 'INVALID_TRANSITION'
  | 'VERSION_MISMATCH'
  | 'MANIFEST_MISMATCH'
  | 'NOT_ACTIVE'
  | 'PENDING_POLICY'
  | 'DISABLED'
  | 'REJECTED'
  | 'STALE_ACTIVATION'
  | 'REGISTRY_UNAVAILABLE'
  | 'DUPLICATE_ID_VERSION';

export interface ExtensionRegistryFailure {
  readonly code: ExtensionRegistryFailureCode;
  readonly reason: string;
}
