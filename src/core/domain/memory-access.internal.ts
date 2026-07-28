import type { ActorId, CorrelationId, ISO8601, OwnerId } from './identity.js';
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

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const protoUnknown: unknown = Object.getPrototypeOf(value);
  return protoUnknown === Object.prototype || protoUnknown === null;
};

const filled = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256;

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
  if (!isPlainObject(observation)) return null;
  const keys = Object.keys(observation);
  if (keys.length !== OBSERVATION_FIELDS.length) return null;
  for (const key of OBSERVATION_FIELDS) if (!Object.hasOwn(observation, key)) return null;
  for (const key of keys) if (!(OBSERVATION_FIELDS as readonly string[]).includes(key)) return null;

  if (
    Object.hasOwn(observation, 'authenticated') ||
    Object.hasOwn(observation, 'trusted') ||
    Object.hasOwn(observation, 'role')
  )
    return null;

  if (
    !filled(observation.ownerId) ||
    !filled(observation.actorId) ||
    !filled(observation.channelId) ||
    !filled(observation.sessionId) ||
    !filled(observation.correlationId) ||
    !filled(observation.issuedAt) ||
    !filled(observation.expiresAt) ||
    !isMemoryNamespace(observation.activeNamespace) ||
    !Array.isArray(observation.roles) ||
    observation.roles.length === 0 ||
    !observation.roles.every((role) => isMemoryRole(role))
  )
    return null;

  if (!isPlainObject(observation.projectScope)) return null;
  const scope = observation.projectScope;
  if (
    !isMemoryNamespace(scope.primary) ||
    !Array.isArray(scope.permitted) ||
    scope.permitted.length === 0 ||
    !scope.permitted.every((item) => isMemoryNamespace(item)) ||
    typeof scope.crossProjectPermitted !== 'boolean'
  )
    return null;

  const issuedAt = Date.parse(observation.issuedAt);
  const expiresAt = Date.parse(observation.expiresAt);
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

  const role = observation.roles[0];
  if (role === undefined || !isMemoryRole(role)) return null;
  if (observation.roles.some((item) => item === 'security-guard') && role !== 'security-guard')
    return null;

  const projectScope: ProjectScope = deepFreeze({
    primary: scope.primary,
    permitted: Object.freeze([...scope.permitted]),
    crossProjectPermitted: scope.crossProjectPermitted,
  });

  const view = deepFreeze({
    ownerId: observation.ownerId as OwnerId,
    actorId: observation.actorId as ActorId,
    role,
    activeNamespace: observation.activeNamespace,
    projectScope,
    correlationId: observation.correlationId as CorrelationId,
    operation,
    channelId: observation.channelId,
    sessionId: observation.sessionId,
    issuedAt: observation.issuedAt as ISO8601,
    expiresAt: observation.expiresAt as ISO8601,
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
