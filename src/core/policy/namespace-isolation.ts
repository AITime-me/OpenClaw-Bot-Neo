import {
  isAuthenticatedMemoryAccessContext,
  type AuthenticatedMemoryAccessContext,
} from '../domain/memory-access.internal.js';
import { isMemoryNamespace, isMemoryRole, validateOperationContext } from '../domain/index.js';
import type { MemoryNamespace, MemoryOperationKind, MemoryRole, OwnerId } from '../domain/index.js';

export type NamespaceDecision =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: string };

export function checkNamespaceAccess(
  active: MemoryNamespace | null,
  target: MemoryNamespace,
  crossProjectApproved: boolean,
): NamespaceDecision {
  if (active === null) return { allowed: false, reason: 'Active namespace is required.' };
  if (active === target) return { allowed: true };
  if (target === 'security-restricted' || active === 'security-restricted')
    return { allowed: false, reason: 'Security-restricted memory is isolated.' };
  if (target === 'personal' || active === 'personal')
    return { allowed: false, reason: 'Personal memory is isolated from projects.' };
  return crossProjectApproved
    ? { allowed: true }
    : { allowed: false, reason: 'Cross-project access requires explicit approval.' };
}

export type MemoryAuthorizationFailureCode =
  | 'MISSING_ACCESS_CONTEXT'
  | 'INVALID_OPERATION_CONTEXT'
  | 'OWNER_MISMATCH'
  | 'NAMESPACE_ISOLATED'
  | 'CROSS_PROJECT_NOT_PERMITTED'
  | 'SECURITY_RESTRICTED'
  | 'ROLE_NOT_PERMITTED';

export type MemoryAuthorizationDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly code: MemoryAuthorizationFailureCode;
      readonly reason: string;
    };

export interface MemoryAuthorizationTarget {
  readonly ownerId: OwnerId;
  readonly namespace: MemoryNamespace;
}

/** AI Scout handles untrusted material and therefore never writes memory directly. */
const WRITE_ROLES: readonly MemoryRole[] = [
  'director',
  'tech-watchdog',
  'integration-engineer',
  'business-analyst',
  'marketing-strategist',
  'personal-assistant',
  'security-guard',
];
const DELETE_ROLES: readonly MemoryRole[] = ['director', 'personal-assistant', 'security-guard'];

const refuse = (
  code: MemoryAuthorizationFailureCode,
  reason: string,
): MemoryAuthorizationDecision => ({ allowed: false, code, reason });

const filled = (value: string | undefined): boolean =>
  typeof value === 'string' && value.length > 0;

const contextIsComplete = (access: AuthenticatedMemoryAccessContext): boolean =>
  filled(access.ownerId) &&
  filled(access.actorId) &&
  filled(access.correlationId) &&
  isMemoryRole(access.role) &&
  isMemoryNamespace(access.activeNamespace) &&
  typeof access.projectScope === 'object' &&
  isMemoryNamespace(access.projectScope.primary) &&
  Array.isArray(access.projectScope.permitted) &&
  access.projectScope.permitted.length > 0 &&
  access.projectScope.permitted.every(isMemoryNamespace) &&
  filled(access.channelId) &&
  filled(access.sessionId);

/**
 * Default deny for every memory operation. Owner and namespace are verified from opaque
 * authenticated evidence before any sink is touched; knowing a record identifier grants nothing.
 * Ordinary MemoryAccessContext object literals are not authorization.
 */
export function authorizeMemoryAccess(
  access: AuthenticatedMemoryAccessContext | null | undefined,
  operation: MemoryOperationKind,
  target: MemoryAuthorizationTarget,
): MemoryAuthorizationDecision {
  if (!isAuthenticatedMemoryAccessContext(access))
    return refuse('MISSING_ACCESS_CONTEXT', 'Authenticated memory access context is required.');
  if (!contextIsComplete(access))
    return refuse('MISSING_ACCESS_CONTEXT', 'Memory access context is incomplete.');
  if (validateOperationContext(access.operation) !== null)
    return refuse('INVALID_OPERATION_CONTEXT', 'Operation context is missing, expired or aborted.');
  if (!filled(target.ownerId) || !isMemoryNamespace(target.namespace))
    return refuse('MISSING_ACCESS_CONTEXT', 'Target owner and namespace are required.');
  if (target.ownerId !== access.ownerId)
    return refuse('OWNER_MISMATCH', 'Target belongs to another owner.');

  const touchesRestricted =
    target.namespace === 'security-restricted' || access.activeNamespace === 'security-restricted';
  if (touchesRestricted) {
    if (
      access.role !== 'security-guard' ||
      target.namespace !== 'security-restricted' ||
      access.activeNamespace !== 'security-restricted'
    )
      return refuse('SECURITY_RESTRICTED', 'Security-restricted memory is isolated.');
  } else if (target.namespace !== access.activeNamespace) {
    if (target.namespace === 'personal' || access.activeNamespace === 'personal')
      return refuse('NAMESPACE_ISOLATED', 'Personal memory is isolated from projects.');
    if (operation === 'write' || operation === 'delete')
      return refuse('NAMESPACE_ISOLATED', 'Mutation across namespaces is forbidden.');
    if (!access.projectScope.crossProjectPermitted)
      return refuse('CROSS_PROJECT_NOT_PERMITTED', 'Cross-project access requires permission.');
    if (!access.projectScope.permitted.includes(target.namespace))
      return refuse('CROSS_PROJECT_NOT_PERMITTED', 'Namespace is outside the project scope.');
  }

  if (operation === 'write' && !WRITE_ROLES.includes(access.role))
    return refuse('ROLE_NOT_PERMITTED', 'Role may not write memory.');
  if (operation === 'delete' && !DELETE_ROLES.includes(access.role))
    return refuse('ROLE_NOT_PERMITTED', 'Role may not delete memory.');

  return { allowed: true };
}
