import { isProxy } from 'node:util/types';
import type { ActorId, CorrelationId, MemoryRecordId, OwnerId } from './identity.js';
import type { MemoryNamespace } from './memory-namespace.js';
import type { OperationContext } from './operation-context.js';
import type { DomainError } from './errors.js';
import { err, ok, type Result } from './result.js';

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

/** Inclusive lower bound for MemoryQueryRequest.limit. No default — callers must pass limit. */
export const MEMORY_QUERY_LIMIT_MIN = 1 as const;
/** Inclusive upper bound for MemoryQueryRequest.limit. Shared by in-memory and future SQLite adapters. */
export const MEMORY_QUERY_LIMIT_MAX = 100 as const;

export interface ProjectScope {
  readonly primary: MemoryNamespace;
  readonly permitted: readonly MemoryNamespace[];
  readonly crossProjectPermitted: boolean;
}

/**
 * Structural memory access fields. This ordinary object is NOT authorization proof.
 * Memory operations require opaque AuthenticatedMemoryAccessContext evidence created by the
 * trusted MemoryAccessGateway composition boundary.
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

/**
 * Memory list request. `limit` is required (1..100); there is no default.
 * `query` is reserved and currently ignored by MemoryPort adapters (not content search).
 */
export interface MemoryQueryRequest {
  readonly query: string;
  readonly targetNamespace: MemoryNamespace;
  readonly expectedOwnerId: OwnerId;
  readonly limit: number;
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

const invalidQueryLimit = (): DomainError => ({
  code: 'VALIDATION_FAILED',
  reason: 'Memory query limit is invalid.',
});

/**
 * Reads MemoryQueryRequest.limit as an own data property without invoking getters or Proxy traps.
 * Accepts only safe integers in [MEMORY_QUERY_LIMIT_MIN, MEMORY_QUERY_LIMIT_MAX].
 * No coercion, clamping, or default. Shared by in-memory and future durable MemoryPort adapters.
 */
export function readMemoryQueryLimit(request: unknown): Result<number, DomainError> {
  if (request === null || typeof request !== 'object') return err(invalidQueryLimit());
  if (isProxy(request)) return err(invalidQueryLimit());

  const descriptor = Object.getOwnPropertyDescriptor(request, 'limit');
  if (descriptor === undefined) return err(invalidQueryLimit());
  if (descriptor.get !== undefined || descriptor.set !== undefined) return err(invalidQueryLimit());
  if (typeof descriptor.value === 'function') return err(invalidQueryLimit());

  const value: unknown = descriptor.value;
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < MEMORY_QUERY_LIMIT_MIN ||
    value > MEMORY_QUERY_LIMIT_MAX
  )
    return err(invalidQueryLimit());

  return ok(value);
}
