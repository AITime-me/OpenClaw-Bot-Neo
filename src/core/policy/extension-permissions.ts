import {
  EXTENSION_PERMISSIONS,
  isDangerousExtensionPermission,
  requiredApprovalEffectFor,
  resolveEffectiveExtensionRisk,
  type ExtensionPermission,
  type ExtensionPermissionDecision,
  type ExtensionPermissionRequest,
} from '../domain/index.js';
import {
  isActiveExtensionRegistration,
  type ActiveExtensionRegistration,
} from '../domain/extension-registry-entry.internal.js';
import {
  isRuntimeRiskEvidence,
  type RuntimeRiskEvidence,
} from '../domain/extension-runtime-risk.internal.js';

const deny = (
  code: Extract<ExtensionPermissionDecision, { allowed: false }>['code'],
  reason: string,
): ExtensionPermissionDecision => ({
  allowed: false,
  effectivePermissions: [],
  code,
  reason,
});

const allKnown = (values: readonly unknown[]): values is readonly ExtensionPermission[] =>
  values.every(
    (value) =>
      typeof value === 'string' && EXTENSION_PERMISSIONS.some((permission) => permission === value),
  );

const isSealedActive = (value: unknown): value is ActiveExtensionRegistration =>
  isActiveExtensionRegistration(value);

const isFresh = (evidence: RuntimeRiskEvidence, now: Date): boolean => {
  const classifiedAt = Date.parse(evidence.classifiedAt);
  const expiresAt = Date.parse(evidence.expiresAt);
  const current = now instanceof Date ? now.getTime() : Number.NaN;
  return (
    Number.isFinite(classifiedAt) &&
    Number.isFinite(expiresAt) &&
    Number.isFinite(current) &&
    expiresAt > classifiedAt &&
    current >= classifiedAt &&
    current < expiresAt
  );
};

/**
 * Effective permissions are the intersection of manifest request, deployment, role, Security
 * Guard and risk policy. Manifest/registration risk cannot be lowered by runtime parameters.
 */
export function resolveExtensionPermissions(
  request: ExtensionPermissionRequest,
): ExtensionPermissionDecision {
  if (!isSealedActive(request.registration))
    return deny('NOT_ACTIVE', 'Sealed active registration evidence is required.');
  const registration = request.registration;
  if (!registration.manifest.enabled)
    return deny('DISABLED_EXTENSION', 'Disabled extension cannot receive permissions.');
  if (request.modelRequestedPermissions !== undefined)
    return deny('MODEL_PERMISSION_OVERRIDE', 'Model output cannot change permissions.');
  if (request.modelRiskOverride !== undefined)
    return deny('MODEL_RISK_OVERRIDE', 'Model output cannot change risk.');
  if (!isRuntimeRiskEvidence(request.runtimeRiskEvidence))
    return deny('MISSING_RISK', 'Sealed runtime risk evidence is required.');
  const riskEvidence = request.runtimeRiskEvidence;
  if (!isFresh(riskEvidence, request.now))
    return deny('STALE_RISK', 'Runtime risk evidence is stale or not yet valid.');
  if (riskEvidence.correlationId !== request.correlationId)
    return deny('OPERATION_MISMATCH', 'Runtime risk evidence is bound to another operation.');
  if (
    riskEvidence.extensionId !== registration.extensionId ||
    riskEvidence.extensionVersion !== registration.version
  )
    return deny('VERSION_MISMATCH', 'Runtime risk evidence does not match the registration.');
  if (riskEvidence.registrationPolicyVersion !== registration.policyVersion)
    return deny('POLICY_MISMATCH', 'Runtime risk evidence policy version mismatch.');
  if (riskEvidence.registrationEffectiveRisk !== registration.effectiveRiskClass)
    return deny('REGISTRATION_MISMATCH', 'Runtime risk evidence registration risk mismatch.');

  const effectiveRisk = resolveEffectiveExtensionRisk(
    registration.manifest.riskClass,
    registration.effectiveRiskClass,
    riskEvidence.classifiedRisk,
    riskEvidence.registrationEffectiveRisk,
  );
  if (!effectiveRisk.ok) return deny('UNKNOWN_RISK', 'Unknown risk class causes deny.');

  if (
    registration.extensionId !== registration.manifest.id ||
    registration.version !== registration.manifest.version
  )
    return deny('VERSION_MISMATCH', 'Registration identity does not match the sealed manifest.');

  const policySets = [
    registration.manifest.requestedPermissions,
    request.policy.deploymentAllowed,
    request.policy.roleAllowed,
    request.policy.securityAllowed,
    request.policy.riskAllowed,
  ];
  if (!policySets.every(allKnown))
    return deny('UNKNOWN_PERMISSION', 'Unknown permission causes a fail-closed decision.');

  for (const permission of registration.manifest.requestedPermissions) {
    if (!isDangerousExtensionPermission(permission)) continue;
    if (!request.policy.deploymentAllowed.includes(permission))
      return deny(
        'DANGEROUS_PERMISSION_NOT_GRANTED',
        'Dangerous permission lacks an explicit deployment grant.',
      );
    const requiredEffect = requiredApprovalEffectFor(permission);
    if (
      requiredEffect === null ||
      !registration.manifest.approvalPolicy.effects.includes(requiredEffect)
    )
      return deny(
        'APPROVAL_EFFECT_MISMATCH',
        'Dangerous permission lacks the matching approval effect.',
      );
    if (registration.manifest.approvalPolicy.mode === 'none')
      return deny('APPROVAL_POLICY_REQUIRED', 'Dangerous permission requires approval policy.');
  }

  const effective = registration.manifest.requestedPermissions.filter((permission) =>
    policySets.slice(1).every((allowed) => allowed.includes(permission)),
  );
  const restricted =
    effectiveRisk.risk === 'untrusted-input'
      ? effective.filter((permission) => !isDangerousExtensionPermission(permission))
      : effective;
  return {
    allowed: true,
    effectivePermissions: Object.freeze([...restricted]),
    effectiveRisk: effectiveRisk.risk,
  };
}
