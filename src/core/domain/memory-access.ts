import type { ActorId, CorrelationId, MemoryRecordId, OwnerId } from './identity.js';
import type { MemoryNamespace } from './memory-namespace.js';
import type { OperationContext } from './operation-context.js';

export const MEMORY_ROLES = Object.freeze([
  'director',
  'tech-watchdog',
  'integration-engineer',
  'business-analyst',
  'marketing-strategist',
  'ai-scout',
  'personal-assistant',
  'security-guard',
] as const);
export type MemoryRole = (typeof MEMORY_ROLES)[number];
export const isMemoryRole = (value: unknown): value is MemoryRole =>
  typeof value === 'string' && (MEMORY_ROLES as readonly string[]).includes(value);

export const MEMORY_NAMESPACES = Object.freeze([
  'tvoe-vremya',
  'ai-my-time',
  'personal',
  'shared-public',
  'security-restricted',
] as const);
export const isMemoryNamespace = (value: unknown): value is MemoryNamespace =>
  typeof value === 'string' && (MEMORY_NAMESPACES as readonly string[]).includes(value);

export interface ProjectScope {
  readonly primary: MemoryNamespace;
  readonly permitted: readonly MemoryNamespace[];
  readonly crossProjectPermitted: boolean;
}

/**
 * Every memory operation requires this context. A namespace carried only inside a
 * caller-supplied record is never trusted as authorization.
 */
export interface MemoryAccessContext {
  readonly ownerId: OwnerId;
  readonly actorId: ActorId;
  readonly role: MemoryRole;
  readonly activeNamespace: MemoryNamespace;
  readonly projectScope: ProjectScope;
  readonly correlationId: CorrelationId;
  readonly operation: OperationContext;
}

export type MemoryOperationKind = 'query' | 'read' | 'write' | 'delete';

export interface MemoryQueryRequest {
  readonly query: string;
  readonly targetNamespace: MemoryNamespace;
  readonly expectedOwnerId: OwnerId;
}
export interface MemoryReadRequest {
  readonly recordId: MemoryRecordId;
  readonly expectedOwnerId: OwnerId;
  readonly expectedNamespace: MemoryNamespace;
}
/** Knowing a record identifier is not authorization: owner and namespace must be asserted. */
export interface MemoryDeleteRequest {
  readonly recordId: MemoryRecordId;
  readonly expectedOwnerId: OwnerId;
  readonly expectedNamespace: MemoryNamespace;
  readonly reason: string;
}
