import { err, ok, type Result } from '../domain/index.js';
import type {
  MemoryDeleteRequest,
  MemoryQueryRequest,
  MemoryReadRequest,
  MemoryRecord,
  OperationContext,
} from '../domain/index.js';
import {
  sealAuthenticatedMemoryAccess,
  type AuthenticatedMemoryAccessContext,
  type AuthenticationObservation,
} from '../domain/memory-access.internal.js';
import { authorizeMemoryAccess } from '../policy/namespace-isolation.js';
import type { ClockPort, MemoryPort } from '../ports/index.js';
import {
  executeMemoryWrite,
  type MemoryWriteCommand,
  type MemoryWriteDeps,
  type MemoryWriteFailure,
  type MemoryWriteOutcome,
} from './memory-write.service.js';

/**
 * Untrusted authentication observation returned by a future channel auth adapter.
 * Favorable booleans are not proof; core validates exact plain data before sealing.
 */
export interface ChannelAuthenticationPort {
  observe(
    rawSessionMaterial: unknown,
    context: OperationContext,
  ): Promise<Result<AuthenticationObservation, { readonly code: string; readonly reason: string }>>;
}

export interface MemoryAccessGatewayDeps {
  readonly auth: ChannelAuthenticationPort;
  readonly clock: ClockPort;
  readonly memory: MemoryPort;
  readonly write: Omit<MemoryWriteDeps, 'memory' | 'clock'>;
}

export type MemoryAccessGatewayFailure =
  | MemoryWriteFailure
  | {
      readonly code:
        | 'AUTHENTICATION_FAILED'
        | 'AUTHENTICATION_UNAVAILABLE'
        | 'AUTHORIZATION_DENIED'
        | 'MEMORY_UNAVAILABLE'
        | 'INVALID_OPERATION_CONTEXT';
      readonly reason?: string;
    };

export interface MemoryAccessGateway {
  write(
    rawSessionMaterial: unknown,
    command: MemoryWriteCommand,
    context: OperationContext,
  ): Promise<Result<MemoryWriteOutcome, MemoryAccessGatewayFailure>>;
  read(
    rawSessionMaterial: unknown,
    request: MemoryReadRequest,
    context: OperationContext,
  ): Promise<Result<MemoryRecord, MemoryAccessGatewayFailure>>;
  query(
    rawSessionMaterial: unknown,
    request: MemoryQueryRequest,
    context: OperationContext,
  ): Promise<Result<readonly MemoryRecord[], MemoryAccessGatewayFailure>>;
  delete(
    rawSessionMaterial: unknown,
    request: MemoryDeleteRequest,
    context: OperationContext,
  ): Promise<Result<void, MemoryAccessGatewayFailure>>;
}

const authenticate = async (
  deps: MemoryAccessGatewayDeps,
  rawSessionMaterial: unknown,
  context: OperationContext,
): Promise<Result<AuthenticatedMemoryAccessContext, MemoryAccessGatewayFailure>> => {
  const observed = await deps.auth.observe(rawSessionMaterial, context);
  if (!observed.ok)
    return err({
      code: 'AUTHENTICATION_UNAVAILABLE',
      reason: 'Authentication dependency failed.',
    });
  const sealed = sealAuthenticatedMemoryAccess(observed.value, context, deps.clock.now());
  if (sealed === null)
    return err({
      code: 'AUTHENTICATION_FAILED',
      reason: 'Authentication observation was rejected.',
    });
  return ok(sealed);
};

/**
 * Trusted composition boundary for memory operations.
 * Request-level callers supply raw session material and operation data only — never
 * owner/actor/role authorization fields. The auth dependency is bound at gateway creation.
 */
export function createMemoryAccessGateway(deps: MemoryAccessGatewayDeps): MemoryAccessGateway {
  const writeDeps: MemoryWriteDeps = {
    ...deps.write,
    memory: deps.memory,
    clock: deps.clock,
  };

  return {
    async write(rawSessionMaterial, command, context) {
      const access = await authenticate(deps, rawSessionMaterial, context);
      if (!access.ok) return access;
      return executeMemoryWrite(writeDeps, access.value, command);
    },

    async read(rawSessionMaterial, request, context) {
      const access = await authenticate(deps, rawSessionMaterial, context);
      if (!access.ok) return access;
      const authorization = authorizeMemoryAccess(access.value, 'read', {
        ownerId: request.expectedOwnerId,
        namespace: request.expectedNamespace,
      });
      if (!authorization.allowed)
        return err({ code: 'AUTHORIZATION_DENIED', reason: authorization.code });
      const result = await deps.memory.read(request, access.value);
      if (!result.ok) return err({ code: 'MEMORY_UNAVAILABLE' });
      return ok(result.value);
    },

    async query(rawSessionMaterial, request, context) {
      const access = await authenticate(deps, rawSessionMaterial, context);
      if (!access.ok) return access;
      const authorization = authorizeMemoryAccess(access.value, 'query', {
        ownerId: request.expectedOwnerId,
        namespace: request.targetNamespace,
      });
      if (!authorization.allowed)
        return err({ code: 'AUTHORIZATION_DENIED', reason: authorization.code });
      const result = await deps.memory.query(request, access.value);
      if (!result.ok) return err({ code: 'MEMORY_UNAVAILABLE' });
      return ok(result.value);
    },

    async delete(rawSessionMaterial, request, context) {
      const access = await authenticate(deps, rawSessionMaterial, context);
      if (!access.ok) return access;
      const authorization = authorizeMemoryAccess(access.value, 'delete', {
        ownerId: request.expectedOwnerId,
        namespace: request.expectedNamespace,
      });
      if (!authorization.allowed)
        return err({ code: 'AUTHORIZATION_DENIED', reason: authorization.code });
      const result = await deps.memory.delete(request, access.value);
      if (!result.ok) return err({ code: 'MEMORY_UNAVAILABLE' });
      return ok(undefined);
    },
  };
}
