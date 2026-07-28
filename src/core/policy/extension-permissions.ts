import {
  DANGEROUS_EXTENSION_PERMISSIONS,
  EXTENSION_PERMISSIONS,
  type ExtensionPermission,
  type ExtensionPermissionDecision,
  type ExtensionPermissionRequest,
} from '../domain/index.js';

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
const isDangerous = (permission: ExtensionPermission): boolean =>
  DANGEROUS_EXTENSION_PERMISSIONS.some((dangerous) => dangerous === permission);

/**
 * Effective permissions are the intersection of manifest request, deployment, role, Security
 * Guard and risk policy. No role (including Director) can turn a deny into an allow.
 */
export function resolveExtensionPermissions(
  request: ExtensionPermissionRequest,
): ExtensionPermissionDecision {
  if (!request.registered || request.manifest === null)
    return deny('UNKNOWN_EXTENSION', 'Registered extension manifest is required.');
  if (!request.manifest.enabled)
    return deny('DISABLED_EXTENSION', 'Disabled extension cannot be activated.');
  if (request.modelRequestedPermissions !== undefined)
    return deny('MODEL_PERMISSION_OVERRIDE', 'Model output cannot change permissions.');

  const policySets = [
    request.manifest.requestedPermissions,
    request.policy.deploymentAllowed,
    request.policy.roleAllowed,
    request.policy.securityAllowed,
    request.policy.riskAllowed,
  ];
  if (!policySets.every(allKnown))
    return deny('UNKNOWN_PERMISSION', 'Unknown permission causes a fail-closed decision.');

  for (const permission of request.manifest.requestedPermissions)
    if (isDangerous(permission) && !request.policy.deploymentAllowed.includes(permission))
      return deny(
        'DANGEROUS_PERMISSION_NOT_GRANTED',
        'Dangerous permission lacks an explicit deployment grant.',
      );

  if (
    request.manifest.requestedPermissions.includes('external-send') &&
    request.manifest.approvalPolicy.mode === 'none'
  )
    return deny('APPROVAL_POLICY_REQUIRED', 'External send requires approval policy.');

  const effective = request.manifest.requestedPermissions.filter((permission) =>
    policySets.slice(1).every((allowed) => allowed.includes(permission)),
  );
  const restricted =
    request.operationRisk === 'untrusted-input'
      ? effective.filter((permission) => !isDangerous(permission))
      : effective;
  return { allowed: true, effectivePermissions: Object.freeze([...restricted]) };
}
