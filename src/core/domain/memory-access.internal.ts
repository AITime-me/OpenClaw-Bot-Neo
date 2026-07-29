import {
  parseActorId,
  parseChannelId,
  parseCorrelationId,
  parseISO8601,
  parseOwnerId,
  parseSessionId,
  type ActorId,
  type CorrelationId,
  type ISO8601,
  type OwnerId,
} from './identity.js';
import type { MemoryNamespace } from './memory-namespace.js';
import {
  isMemoryNamespace,
  isMemoryRole,
  type MemoryRole,
  type ProjectScope,
} from './memory-access.js';
import type { OperationContext } from './operation-context.js';
import { deepFreeze } from './immutable.js';
import { validateOperationContext } from './operation-context.js';
import { exactPlainObservation, exactStringArray } from './observation-validation.js';

/**
 * Opaque authenticated memory access evidence.
 * Trust is WeakMap membership only — Symbol properties and object shape are not proof.
 */

export interface AuthenticatedMemoryAccessContext {
  readonly ownerId: OwnerId;
  readonly actorId: ActorId;
  readonly role: MemoryRole;
  readonly activeNamespace: MemoryNamespace;
  readonly projectScope: ProjectScope;
  readonly correlationId: CorrelationId;
  readonly operation: OperationContext;
  readonly channelId: string;
  readonly sessionId: string;
  readonly issuedAt: ISO8601;
  readonly expiresAt: ISO8601;
  readonly authenticationProvenance: 'trusted-channel-auth';
}

export interface AuthenticationObservation {
  readonly ownerId: string;
  readonly actorId: string;
  readonly roles: readonly string[];
  readonly activeNamespace: string;
  readonly projectScope: {
    readonly primary: string;
    readonly permitted: readonly string[];
    readonly crossProjectPermitted: boolean;
  };
  readonly channelId: string;
  readonly sessionId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly correlationId: string;
}

interface AuthenticatedCanonical {
  readonly ownerId: OwnerId;
  readonly actorId: ActorId;
  readonly role: MemoryRole;
  readonly activeNamespace: MemoryNamespace;
  readonly projectScope: ProjectScope;
  readonly correlationId: CorrelationId;
  readonly operation: OperationContext;
  readonly channelId: string;
  readonly sessionId: string;
  readonly issuedAt: ISO8601;
  readonly expiresAt: ISO8601;
  readonly authenticationProvenance: 'trusted-channel-auth';
}

const authenticatedRegistry = new WeakMap<object, AuthenticatedCanonical>();

const OBSERVATION_FIELDS = Object.freeze([
  'ownerId',
  'actorId',
  'roles',
  'activeNamespace',
  'projectScope',
  'channelId',
  'sessionId',
  'issuedAt',
  'expiresAt',
  'correlationId',
] as const);

/**
 * Validates an untrusted authentication observation and seals authenticated access evidence.
 * Callers cannot supply ready-made evidence; only this module registers membership.
 */
export const sealAuthenticatedMemoryAccess = (
  observation: unknown,
  operation: OperationContext,
  now: Date,
): AuthenticatedMemoryAccessContext | null => {
  if (validateOperationContext(operation) !== null) return null;
  const plain = exactPlainObservation(observation, OBSERVATION_FIELDS);
  if (plain === null) return null;

  const ownerId = parseOwnerId(plain.ownerId);
  const actorId = parseActorId(plain.actorId);
  const channelId = parseChannelId(plain.channelId);
  const sessionId = parseSessionId(plain.sessionId);
  const correlationId = parseCorrelationId(plain.correlationId);
  const issuedAtIdentity = parseISO8601(plain.issuedAt);
  const expiresAtIdentity = parseISO8601(plain.expiresAt);
  const roles = exactStringArray(plain.roles);
  if (
    !ownerId.ok ||
    !actorId.ok ||
    !channelId.ok ||
    !sessionId.ok ||
    !correlationId.ok ||
    !issuedAtIdentity.ok ||
    !expiresAtIdentity.ok ||
    !isMemoryNamespace(plain.activeNamespace) ||
    roles === null ||
    roles.length === 0 ||
    !roles.every((role) => isMemoryRole(role))
  )
    return null;

  const scope = exactPlainObservation(plain.projectScope, [
    'primary',
    'permitted',
    'crossProjectPermitted',
  ]);
  if (scope === null) return null;
  const permitted = exactStringArray(scope.permitted);
  if (
    !isMemoryNamespace(scope.primary) ||
    permitted === null ||
    permitted.length === 0 ||
    !permitted.every((item) => isMemoryNamespace(item)) ||
    typeof scope.crossProjectPermitted !== 'boolean'
  )
    return null;

  const issuedAt = new Date(issuedAtIdentity.value).getTime();
  const expiresAt = new Date(expiresAtIdentity.value).getTime();
  const current = now.getTime();
  if (
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    !Number.isFinite(current) ||
    expiresAt <= issuedAt ||
    current < issuedAt ||
    current >= expiresAt
  )
    return null;

  const role = roles[0];
  if (role === undefined || !isMemoryRole(role)) return null;
  if (roles.some((item) => item === 'security-guard') && role !== 'security-guard') return null;

  const projectScope: ProjectScope = deepFreeze({
    primary: scope.primary,
    permitted: Object.freeze([...permitted]),
    crossProjectPermitted: scope.crossProjectPermitted,
  });

  const view = deepFreeze({
    ownerId: ownerId.value,
    actorId: actorId.value,
    role,
    activeNamespace: plain.activeNamespace,
    projectScope,
    correlationId: correlationId.value,
    operation,
    channelId: channelId.value,
    sessionId: sessionId.value,
    issuedAt: issuedAtIdentity.value,
    expiresAt: expiresAtIdentity.value,
    authenticationProvenance: 'trusted-channel-auth' as const,
  });

  authenticatedRegistry.set(view, view);
  return view;
};

export const isAuthenticatedMemoryAccessContext = (
  value: unknown,
): value is AuthenticatedMemoryAccessContext =>
  typeof value === 'object' && value !== null && authenticatedRegistry.has(value);

export const getAuthenticatedMemoryAccessCanonical = (
  value: AuthenticatedMemoryAccessContext,
): AuthenticatedCanonical | null => authenticatedRegistry.get(value) ?? null;
