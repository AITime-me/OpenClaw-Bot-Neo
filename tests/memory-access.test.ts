import { describe, expect, it } from 'vitest';
import type { MemoryDeleteRequest, MemoryRole } from '../src/core/domain/index.js';
import { authorizeMemoryAccess } from '../src/core/policy/index.js';
import {
  accessContext,
  asActor,
  asCorrelation,
  asOwner,
  asRecordId,
  operationContext,
} from './support/fixtures.js';

const projectAccess = (role: MemoryRole = 'business-analyst', crossProject = false) =>
  accessContext({
    role,
    activeNamespace: 'tvoe-vremya',
    projectScope: {
      primary: 'tvoe-vremya',
      permitted: crossProject ? ['tvoe-vremya', 'ai-my-time'] : ['tvoe-vremya'],
      crossProjectPermitted: crossProject,
    },
  });

const deleteRequest = (namespace: 'personal' | 'tvoe-vremya'): MemoryDeleteRequest => ({
  recordId: asRecordId(),
  expectedOwnerId: asOwner(),
  expectedNamespace: namespace,
  reason: 'owner requested removal',
});

describe('authenticated context is mandatory', () => {
  it.each([
    ['missing context', undefined],
    ['null context', null],
  ])('denies %s', (_label, access) => {
    const decision = authorizeMemoryAccess(access, 'query', {
      ownerId: asOwner(),
      namespace: 'personal',
    });
    expect(decision).toEqual({
      allowed: false,
      code: 'MISSING_ACCESS_CONTEXT',
      reason: 'Authenticated memory access context is required.',
    });
  });

  it.each([
    ['empty owner', accessContext({ ownerId: asOwner('') })],
    ['empty actor', accessContext({ actorId: asActor('') })],
    ['empty correlation id', accessContext({ correlationId: asCorrelation('') })],
    ['unknown role', accessContext({ role: 'intruder' as MemoryRole })],
  ])('denies an incomplete context: %s', (_label, access) => {
    const decision = authorizeMemoryAccess(access, 'query', {
      ownerId: asOwner(),
      namespace: 'personal',
    });
    expect(decision.allowed).toBe(false);
  });

  it('denies an aborted operation context', () => {
    const controller = new AbortController();
    controller.abort();
    const decision = authorizeMemoryAccess(
      accessContext({ operation: operationContext({ signal: controller.signal }) }),
      'query',
      { ownerId: asOwner(), namespace: 'personal' },
    );
    expect(decision).toMatchObject({ allowed: false, code: 'INVALID_OPERATION_CONTEXT' });
  });

  it('denies a target that belongs to another owner', () => {
    const decision = authorizeMemoryAccess(accessContext(), 'query', {
      ownerId: asOwner('owner-2'),
      namespace: 'personal',
    });
    expect(decision).toMatchObject({ allowed: false, code: 'OWNER_MISMATCH' });
  });
});

describe('namespace isolation for query, write and delete', () => {
  it('allows same-owner and same-namespace access for a sufficient role', () => {
    for (const operation of ['query', 'read', 'write', 'delete'] as const)
      expect(
        authorizeMemoryAccess(accessContext(), operation, {
          ownerId: asOwner(),
          namespace: 'personal',
        }),
      ).toEqual({ allowed: true });
  });

  it('never lets a project namespace touch personal memory', () => {
    for (const operation of ['query', 'read', 'write', 'delete'] as const)
      expect(
        authorizeMemoryAccess(projectAccess('director'), operation, {
          ownerId: asOwner(),
          namespace: 'personal',
        }),
      ).toMatchObject({ allowed: false, code: 'NAMESPACE_ISOLATED' });
  });

  it('never lets an ordinary role touch security-restricted memory', () => {
    expect(
      authorizeMemoryAccess(projectAccess('director'), 'query', {
        ownerId: asOwner(),
        namespace: 'security-restricted',
      }),
    ).toMatchObject({ allowed: false, code: 'SECURITY_RESTRICTED' });
  });

  it('allows the security guard inside security-restricted memory only', () => {
    const guard = accessContext({
      role: 'security-guard',
      activeNamespace: 'security-restricted',
      projectScope: {
        primary: 'security-restricted',
        permitted: ['security-restricted'],
        crossProjectPermitted: false,
      },
    });
    expect(
      authorizeMemoryAccess(guard, 'write', {
        ownerId: asOwner(),
        namespace: 'security-restricted',
      }),
    ).toEqual({ allowed: true });
    expect(
      authorizeMemoryAccess(guard, 'query', { ownerId: asOwner(), namespace: 'tvoe-vremya' }),
    ).toMatchObject({ allowed: false, code: 'SECURITY_RESTRICTED' });
  });

  it('requires explicit permission for cross-project reads', () => {
    expect(
      authorizeMemoryAccess(projectAccess('business-analyst'), 'query', {
        ownerId: asOwner(),
        namespace: 'ai-my-time',
      }),
    ).toMatchObject({ allowed: false, code: 'CROSS_PROJECT_NOT_PERMITTED' });
    expect(
      authorizeMemoryAccess(projectAccess('business-analyst', true), 'query', {
        ownerId: asOwner(),
        namespace: 'ai-my-time',
      }),
    ).toEqual({ allowed: true });
  });

  it('forbids cross-project mutation even with permission', () => {
    for (const operation of ['write', 'delete'] as const)
      expect(
        authorizeMemoryAccess(projectAccess('director', true), operation, {
          ownerId: asOwner(),
          namespace: 'ai-my-time',
        }),
      ).toMatchObject({ allowed: false, code: 'NAMESPACE_ISOLATED' });
  });
});

describe('role limits', () => {
  it('refuses memory writes from the untrusted scout role', () => {
    expect(
      authorizeMemoryAccess(projectAccess('ai-scout'), 'write', {
        ownerId: asOwner(),
        namespace: 'tvoe-vremya',
      }),
    ).toMatchObject({ allowed: false, code: 'ROLE_NOT_PERMITTED' });
  });

  it('refuses deletion from a role without delete rights', () => {
    expect(
      authorizeMemoryAccess(projectAccess('business-analyst'), 'delete', {
        ownerId: asOwner(),
        namespace: 'tvoe-vremya',
      }),
    ).toMatchObject({ allowed: false, code: 'ROLE_NOT_PERMITTED' });
  });
});

describe('a record identifier is not authorization', () => {
  it('denies deletion when the asserted namespace is outside the active one', () => {
    const request = deleteRequest('personal');
    const decision = authorizeMemoryAccess(projectAccess('director'), 'delete', {
      ownerId: request.expectedOwnerId,
      namespace: request.expectedNamespace,
    });
    expect(decision).toMatchObject({ allowed: false, code: 'NAMESPACE_ISOLATED' });
  });

  it('denies deletion when the asserted owner does not match the context', () => {
    const decision = authorizeMemoryAccess(accessContext(), 'delete', {
      ownerId: asOwner('owner-2'),
      namespace: 'personal',
    });
    expect(decision).toMatchObject({ allowed: false, code: 'OWNER_MISMATCH' });
  });

  it('allows deletion only when owner, namespace and role all match', () => {
    const request = deleteRequest('tvoe-vremya');
    expect(
      authorizeMemoryAccess(projectAccess('director'), 'delete', {
        ownerId: request.expectedOwnerId,
        namespace: request.expectedNamespace,
      }),
    ).toEqual({ allowed: true });
  });
});
