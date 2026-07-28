import {
  err,
  isExtensionRiskClass,
  isSourceTrustClassification,
  ok,
  resolveEffectiveExtensionRisk,
  validateOperationContext,
  type ExtensionRiskClass,
  type ExtensionRuntimeRiskFeatures,
  type ISO8601,
  type OperationContext,
  type Result,
} from '../domain/index.js';
import {
  sealRuntimeRiskEvidence,
  type RuntimeRiskEvidence,
} from '../domain/extension-runtime-risk.internal.js';
import type { ClockPort } from '../ports/index.js';
import { isActiveExtensionRegistration } from '../domain/extension-registry-entry.internal.js';

export interface RuntimeRiskClassificationDeps {
  readonly clock: ClockPort;
  /** Evidence lifetime in milliseconds. */
  readonly evidenceTtlMs: number;
}

export type RuntimeRiskClassificationFailure = {
  readonly code:
    | 'INVALID_OPERATION_CONTEXT'
    | 'INVALID_FEATURES'
    | 'UNKNOWN_RISK'
    | 'NOT_ACTIVE'
    | 'VERSION_MISMATCH'
    | 'POLICY_MISMATCH';
  readonly reason: string;
};

const EVIDENCE_TTL_DEFAULT_MS = 60_000;

const sourceFloor = (trust: ExtensionRuntimeRiskFeatures['sourceTrust']): ExtensionRiskClass =>
  trust === 'untrusted-input' ? 'untrusted-input' : trust === 'system-derived' ? 'medium' : 'low';

/**
 * Deterministic trusted classifier. Callers may supply operation features and a sealed active
 * registration; they cannot supply ready-made risk evidence.
 */
export function classifyExtensionRuntimeRisk(
  deps: RuntimeRiskClassificationDeps,
  registration: unknown,
  features: ExtensionRuntimeRiskFeatures,
  context: OperationContext,
): Result<RuntimeRiskEvidence, RuntimeRiskClassificationFailure> {
  if (validateOperationContext(context) !== null)
    return err({
      code: 'INVALID_OPERATION_CONTEXT',
      reason: 'Valid operation context is required.',
    });
  if (!isActiveExtensionRegistration(registration))
    return err({ code: 'NOT_ACTIVE', reason: 'Sealed active registration is required.' });
  if (
    typeof features.extensionId !== 'string' ||
    features.extensionId.length === 0 ||
    typeof features.extensionVersion !== 'string' ||
    features.extensionVersion.length === 0 ||
    typeof features.correlationId !== 'string' ||
    features.correlationId.length === 0 ||
    typeof features.policyVersion !== 'string' ||
    features.policyVersion.length === 0 ||
    !isSourceTrustClassification(features.sourceTrust) ||
    !isExtensionRiskClass(features.securityGuardFloor) ||
    !isExtensionRiskClass(features.registrationEffectiveRisk) ||
    typeof features.externalEffect !== 'boolean' ||
    typeof features.untrustedContentPresent !== 'boolean'
  )
    return err({ code: 'INVALID_FEATURES', reason: 'Runtime risk features are malformed.' });
  if (
    features.extensionId !== registration.extensionId ||
    features.extensionVersion !== registration.version
  )
    return err({ code: 'VERSION_MISMATCH', reason: 'Features do not match the registration.' });
  if (features.registrationPolicyVersion !== registration.policyVersion)
    return err({ code: 'POLICY_MISMATCH', reason: 'Registration policy version mismatch.' });
  if (features.registrationEffectiveRisk !== registration.effectiveRiskClass)
    return err({ code: 'POLICY_MISMATCH', reason: 'Registration effective risk mismatch.' });

  const operationFloor: ExtensionRiskClass =
    features.untrustedContentPresent || features.sourceTrust === 'untrusted-input'
      ? 'untrusted-input'
      : features.externalEffect
        ? 'high'
        : sourceFloor(features.sourceTrust);

  const merged = resolveEffectiveExtensionRisk(
    registration.manifest.riskClass,
    registration.effectiveRiskClass,
    features.registrationEffectiveRisk,
    features.securityGuardFloor,
    operationFloor,
  );
  if (!merged.ok) return err({ code: 'UNKNOWN_RISK', reason: 'Risk classification failed.' });

  const ttl =
    Number.isSafeInteger(deps.evidenceTtlMs) && deps.evidenceTtlMs > 0
      ? deps.evidenceTtlMs
      : EVIDENCE_TTL_DEFAULT_MS;
  const classifiedAt = deps.clock.now();
  const expiresAt = new Date(classifiedAt.getTime() + ttl);
  return ok(
    sealRuntimeRiskEvidence({
      extensionId: registration.extensionId,
      extensionVersion: registration.version,
      correlationId: features.correlationId,
      classifiedRisk: merged.risk,
      sourceTrustClassification: features.sourceTrust,
      policyVersion: features.policyVersion,
      registrationPolicyVersion: registration.policyVersion,
      registrationEffectiveRisk: registration.effectiveRiskClass,
      classifiedAt: classifiedAt.toISOString() as ISO8601,
      expiresAt: expiresAt.toISOString() as ISO8601,
      provenance: 'trusted-runtime-classifier',
    }),
  );
}
