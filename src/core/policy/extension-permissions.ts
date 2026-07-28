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
  activeExtensionRegistrationBrand,
  type ActiveExtensionRegistration,
} from '../domain/extension-registry-entry.internal.js';

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
  typeof value === 'object' && value !== null && activeExtensionRegistrationBrand in value;

/**
 * Effective permissions are the intersection of manifest request, deployment, role, Security
 * Guard and risk policy. Manifest risk cannot be lowered by runtime parameters. No role
 * (including Director) can turn a deny into an allow. Pending/disabled/rejected registrations deny.
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
  if (request.runtimeRisk === null)
    return deny('MISSING_RISK', 'Trusted runtime risk evidence is required.');

  const effectiveRisk = resolveEffectiveExtensionRisk(
    registration.manifest.riskClass,
    request.runtimeRisk,
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
