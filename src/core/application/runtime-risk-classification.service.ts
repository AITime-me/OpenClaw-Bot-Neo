import {
  err,
  isExtensionRiskClass,
  isSourceTrustClassification,
  ok,
  resolveEffectiveExtensionRisk,
  validateOperationContext,
  type CorrelationId,
  type ExtensionRiskClass,
  type ISO8601,
  type OperationContext,
  type Result,
} from '../domain/index.js';
import {
  isCurrentExtensionPolicySnapshot,
  type CurrentExtensionPolicySnapshot,
} from '../domain/extension-policy.internal.js';
import {
  sealRuntimeRiskEvidence,
  type RuntimeRiskEvidence,
} from '../domain/extension-runtime-risk.internal.js';
import { isActiveExtensionRegistration } from '../domain/extension-registry-entry.internal.js';
import {
  exactPlainObservation,
  filledString,
  isFreshWindow,
  parseIsoInstant,
} from '../domain/observation-validation.js';
import type { ClockPort } from '../ports/index.js';
import type {
  RoutingObservation,
  SecurityGuardObservation,
} from '../ports/trusted-derivation.port.js';

export interface RuntimeRiskClassificationDeps {
  readonly clock: ClockPort;
}

export type RuntimeRiskClassificationFailure = {
  readonly code:
    | 'INVALID_OPERATION_CONTEXT'
    | 'INVALID_OBSERVATION'
    | 'UNKNOWN_RISK'
    | 'NOT_ACTIVE'
    | 'VERSION_MISMATCH'
    | 'POLICY_MISMATCH'
    | 'OPERATION_MISMATCH'
    | 'STALE_OBSERVATION'
    | 'SECURITY_DENIED';
  readonly reason: string;
};

/** Operation-only request facts — never trust/risk/policy grants. */
export interface RuntimeRiskOperationRequest {
  readonly correlationId: CorrelationId;
  readonly operationCategory: string;
  readonly sourceReference: string;
  /** Non-proof payload hints used only as operation floor inputs after validation. */
  readonly operationHints?: {
    readonly externalEffect?: boolean;
    readonly untrustedContentPresent?: boolean;
  };
}

const ROUTING_FIELDS = Object.freeze([
  'extensionId',
  'extensionVersion',
  'correlationId',
  'sourceTrust',
  'routingRiskFloor',
  'sourceReference',
  'channelId',
  'sessionId',
  'observedAt',
  'expiresAt',
] as const);

const GUARD_FIELDS = Object.freeze([
  'extensionId',
  'extensionVersion',
  'correlationId',
  'securityGuardFloor',
  'denied',
  'allowedPermissions',
  'observedAt',
  'expiresAt',
] as const);

const sourceFloor = (trust: RoutingObservation['sourceTrust']): ExtensionRiskClass =>
  trust === 'untrusted-input' ? 'untrusted-input' : trust === 'system-derived' ? 'medium' : 'low';

const categoryFloor = (category: string): ExtensionRiskClass => {
  if (category === 'untrusted-ingest' || category === 'external-untrusted')
    return 'untrusted-input';
  if (category === 'external-effect' || category === 'integration-write') return 'high';
  if (category === 'system-observe') return 'medium';
  return 'low';
};

export const parseRoutingObservation = (
  observation: unknown,
  expected: {
    readonly extensionId: string;
    readonly extensionVersion: string;
    readonly correlationId: string;
    readonly sourceReference: string;
  },
  now: Date,
): RoutingObservation | null => {
  const plain = exactPlainObservation(observation, ROUTING_FIELDS);
  if (plain === null) return null;
  if (
    !filledString(plain.extensionId) ||
    !filledString(plain.extensionVersion) ||
    !filledString(plain.correlationId) ||
    !filledString(plain.sourceReference) ||
    !filledString(plain.channelId) ||
    !filledString(plain.sessionId) ||
    !isSourceTrustClassification(plain.sourceTrust) ||
    !isExtensionRiskClass(plain.routingRiskFloor)
  )
    return null;
  if (
    plain.extensionId !== expected.extensionId ||
    plain.extensionVersion !== expected.extensionVersion ||
    plain.correlationId !== expected.correlationId ||
    plain.sourceReference !== expected.sourceReference
  )
    return null;
  const observedAt = parseIsoInstant(plain.observedAt);
  const expiresAt = parseIsoInstant(plain.expiresAt);
  if (observedAt === null || expiresAt === null || !isFreshWindow(observedAt, expiresAt, now))
    return null;
  return {
    extensionId: plain.extensionId,
    extensionVersion: plain.extensionVersion,
    correlationId: plain.correlationId,
    sourceTrust: plain.sourceTrust,
    routingRiskFloor: plain.routingRiskFloor,
    sourceReference: plain.sourceReference,
    channelId: plain.channelId,
    sessionId: plain.sessionId,
    observedAt: plain.observedAt as string,
    expiresAt: plain.expiresAt as string,
  };
};

export const parseSecurityGuardObservation = (
  observation: unknown,
  expected: {
    readonly extensionId: string;
    readonly extensionVersion: string;
    readonly correlationId: string;
  },
  now: Date,
): SecurityGuardObservation | null => {
  const plain = exactPlainObservation(observation, GUARD_FIELDS);
  if (plain === null) return null;
  if (
    !filledString(plain.extensionId) ||
    !filledString(plain.extensionVersion) ||
    !filledString(plain.correlationId) ||
    !isExtensionRiskClass(plain.securityGuardFloor) ||
    typeof plain.denied !== 'boolean' ||
    !Array.isArray(plain.allowedPermissions)
  )
    return null;
  if (
    plain.extensionId !== expected.extensionId ||
    plain.extensionVersion !== expected.extensionVersion ||
    plain.correlationId !== expected.correlationId
  )
    return null;
  const observedAt = parseIsoInstant(plain.observedAt);
  const expiresAt = parseIsoInstant(plain.expiresAt);
  if (observedAt === null || expiresAt === null || !isFreshWindow(observedAt, expiresAt, now))
    return null;
  return {
    extensionId: plain.extensionId,
    extensionVersion: plain.extensionVersion,
    correlationId: plain.correlationId,
    securityGuardFloor: plain.securityGuardFloor,
    denied: plain.denied,
    allowedPermissions: plain.allowedPermissions as SecurityGuardObservation['allowedPermissions'],
    observedAt: plain.observedAt as string,
    expiresAt: plain.expiresAt as string,
  };
};

/**
 * Trusted classifier. Accepts only sealed active registration, sealed current policy,
 * and validated routing/Security Guard observations — never caller trust/risk/policy grants.
 */
export function classifyExtensionRuntimeRisk(
  deps: RuntimeRiskClassificationDeps,
  registration: unknown,
  policy: CurrentExtensionPolicySnapshot,
  routing: RoutingObservation,
  securityGuard: SecurityGuardObservation,
  request: RuntimeRiskOperationRequest,
  context: OperationContext,
): Result<RuntimeRiskEvidence, RuntimeRiskClassificationFailure> {
  if (validateOperationContext(context) !== null)
    return err({
      code: 'INVALID_OPERATION_CONTEXT',
      reason: 'Valid operation context is required.',
    });
  if (!isActiveExtensionRegistration(registration))
    return err({ code: 'NOT_ACTIVE', reason: 'Sealed active registration is required.' });
  if (!isCurrentExtensionPolicySnapshot(policy))
    return err({ code: 'POLICY_MISMATCH', reason: 'Sealed current policy snapshot is required.' });
  if (
    typeof request.correlationId !== 'string' ||
    request.correlationId.length === 0 ||
    typeof request.operationCategory !== 'string' ||
    request.operationCategory.length === 0 ||
    typeof request.sourceReference !== 'string' ||
    request.sourceReference.length === 0
  )
    return err({ code: 'INVALID_OBSERVATION', reason: 'Operation request is malformed.' });
  if (
    policy.extensionId !== registration.extensionId ||
    policy.extensionVersion !== registration.version
  )
    return err({ code: 'POLICY_MISMATCH', reason: 'Policy snapshot does not match registration.' });
  if (policy.policyVersion !== registration.policyVersion)
    return err({ code: 'POLICY_MISMATCH', reason: 'Registry policy version mismatch.' });
  if (routing.correlationId !== request.correlationId)
    return err({ code: 'OPERATION_MISMATCH', reason: 'Routing observation correlation mismatch.' });
  if (securityGuard.correlationId !== request.correlationId)
    return err({
      code: 'OPERATION_MISMATCH',
      reason: 'Security Guard observation correlation mismatch.',
    });
  if (securityGuard.denied)
    return err({ code: 'SECURITY_DENIED', reason: 'Security Guard denied the operation.' });

  const hints = request.operationHints ?? {};
  const externalEffect = hints.externalEffect === true;
  const untrustedContentPresent = hints.untrustedContentPresent === true;
  const category = categoryFloor(request.operationCategory);
  const fromSource = sourceFloor(routing.sourceTrust);
  const floors = resolveEffectiveExtensionRisk(
    fromSource,
    routing.routingRiskFloor,
    category,
    externalEffect ? 'high' : 'low',
    untrustedContentPresent || routing.sourceTrust === 'untrusted-input'
      ? 'untrusted-input'
      : 'low',
  );
  if (!floors.ok) return err({ code: 'UNKNOWN_RISK', reason: 'Operation floor failed.' });
  const operationFloor = floors.risk;

  const merged = resolveEffectiveExtensionRisk(
    registration.manifest.riskClass,
    registration.effectiveRiskClass,
    routing.routingRiskFloor,
    fromSource,
    securityGuard.securityGuardFloor,
    operationFloor,
  );
  if (!merged.ok) return err({ code: 'UNKNOWN_RISK', reason: 'Risk classification failed.' });

  const now = deps.clock.now();
  const ttl = policy.runtimeEvidenceTtlMs;
  const classifiedAt = now;
  const expiresAt = new Date(classifiedAt.getTime() + ttl);
  return ok(
    sealRuntimeRiskEvidence({
      extensionId: registration.extensionId,
      extensionVersion: registration.version,
      correlationId: request.correlationId,
      classifiedRisk: merged.risk,
      sourceTrustClassification: routing.sourceTrust,
      policyVersion: policy.riskPolicyVersion,
      registrationPolicyVersion: registration.policyVersion,
      registrationEffectiveRisk: registration.effectiveRiskClass,
      classifiedAt: classifiedAt.toISOString() as ISO8601,
      expiresAt: expiresAt.toISOString() as ISO8601,
      provenance: 'trusted-runtime-classifier',
    }),
  );
}
