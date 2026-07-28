import type { CorrelationId, ISO8601 } from './identity.js';
import type { ExtensionRiskClass } from './extension-risk.js';

export const SOURCE_TRUST_CLASSIFICATIONS = Object.freeze([
  'owner-stated',
  'system-derived',
  'untrusted-input',
] as const);
export type SourceTrustClassification = (typeof SOURCE_TRUST_CLASSIFICATIONS)[number];

export const isSourceTrustClassification = (value: unknown): value is SourceTrustClassification =>
  typeof value === 'string' && (SOURCE_TRUST_CLASSIFICATIONS as readonly string[]).includes(value);

/**
 * Untrusted operation features for the deterministic runtime-risk classifier.
 * Callers supply facts; they never supply sealed risk evidence.
 */
export interface ExtensionRuntimeRiskFeatures {
  readonly extensionId: string;
  readonly extensionVersion: string;
  readonly correlationId: CorrelationId;
  readonly policyVersion: string;
  readonly registrationPolicyVersion: string;
  readonly registrationEffectiveRisk: ExtensionRiskClass;
  readonly sourceTrust: SourceTrustClassification;
  /** Controlled security-guard floor; unknown values deny. */
  readonly securityGuardFloor: ExtensionRiskClass;
  /** Whether the operation mutates external state or leaves the local boundary. */
  readonly externalEffect: boolean;
  readonly untrustedContentPresent: boolean;
}

export interface RuntimeRiskEvidenceData {
  readonly extensionId: string;
  readonly extensionVersion: string;
  readonly correlationId: CorrelationId;
  readonly classifiedRisk: ExtensionRiskClass;
  readonly sourceTrustClassification: SourceTrustClassification;
  readonly policyVersion: string;
  readonly registrationPolicyVersion: string;
  readonly registrationEffectiveRisk: ExtensionRiskClass;
  readonly classifiedAt: ISO8601;
  readonly expiresAt: ISO8601;
  readonly provenance: 'trusted-runtime-classifier';
}
