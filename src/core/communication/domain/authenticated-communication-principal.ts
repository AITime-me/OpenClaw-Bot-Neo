import type { CommunicationBindingVersion } from './communication-identity.js';

/**
 * Opaque communication authority for a single turn.
 * Trust is WeakMap membership only — object shape, freeze status, and spread are not proof.
 */
export type AuthenticatedCommunicationPrincipal = {
  readonly kind?: never;
};

export interface CommunicationPrincipalRedactedMetadata {
  readonly kind: 'authenticated-communication-principal';
  readonly bindingVersion: CommunicationBindingVersion;
}

/**
 * Evidence that a turn was freshly admitted at observed state.
 * Runtime sealing lives in the internal module; this type is public for port contracts.
 */
export interface FreshObservedAdmissionEvidence {
  readonly kind: 'fresh-observed-admission-evidence';
}
