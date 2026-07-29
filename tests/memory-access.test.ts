import { describe, expect, it } from 'vitest';
import type { MemoryDeleteRequest, MemoryRole } from '../src/core/domain/index.js';
import {
  isAuthenticatedMemoryAccessContext,
  sealAuthenticatedMemoryAccess,
} from '../src/core/domain/memory-access.internal.js';
import { authorizeMemoryAccess } from '../src/core/policy/index.js';
import { createMemoryAccessGateway } from '../src/core/application/memory-access.gateway.js';
import { ok } from '../src/core/domain/index.js';
import {
  accessContext,
  asActor,
  asCorrelation,
  asOwner,
  asRecordId,
  authenticatedAccess,
  createHarness,
  fixedClock,
  NOW,
  operationContext,
  writeCommand,
} from './support/fixtures.js';
import * as publicApi from '../src/index.js';

const projectAccess = (role: MemoryRole = 'business-analyst', crossProject = false) =>
  authenticatedAccess({
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

  it('rejects ordinary and frozen forged MemoryAccessContext objects', () => {
    const ordinary = accessContext({ role: 'security-guard' });
    const frozen = Object.freeze({ ...ordinary });
    expect(
      authorizeMemoryAccess(ordinary as never, 'query', {
        ownerId: asOwner(),
        namespace: 'personal',
      }).allowed,
    ).toBe(false);
    expect(
      authorizeMemoryAccess(frozen as never, 'write', {
        ownerId: asOwner(),
        namespace: 'security-restricted',
      }).allowed,
    ).toBe(false);
  });

  it('rejects spread, prototype and JSON clones of legitimate evidence', () => {
    const legitimate = authenticatedAccess();
    expect(isAuthenticatedMemoryAccessContext(legitimate)).toBe(true);
    expect(isAuthenticatedMemoryAccessContext({ ...legitimate })).toBe(false);
    expect(isAuthenticatedMemoryAccessContext(Object.assign({}, legitimate))).toBe(false);
    expect(isAuthenticatedMemoryAccessContext(Object.create(legitimate))).toBe(false);
    expect(isAuthenticatedMemoryAccessContext(JSON.parse(JSON.stringify(legitimate)))).toBe(false);
    expect(Object.getOwnPropertySymbols(legitimate)).toEqual([]);
  });

  it('denies aborted operation context', () => {
    const controller = new AbortController();
    const access = authenticatedAccess({
      operation: operationContext({ signal: controller.signal }),
    });
    controller.abort();
    const decision = authorizeMemoryAccess(access, 'query', {
      ownerId: asOwner(),
      namespace: 'personal',
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('INVALID_OPERATION_CONTEXT');
  });

  it('denies owner mismatch even when the caller knows the record id', () => {
    const decision = authorizeMemoryAccess(authenticatedAccess(), 'query', {
      ownerId: asOwner('other-owner'),
      namespace: 'personal',
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('OWNER_MISMATCH');
  });

  it('rejects authentication getters/proxies and retains no mutable authority arrays', () => {
    const base = {
      ownerId: asOwner(),
      actorId: asActor(),
      roles: ['personal-assistant'],
      activeNamespace: 'personal',
      projectScope: {
        primary: 'personal',
        permitted: ['personal'],
        crossProjectPermitted: false,
      },
      channelId: 'channel',
      sessionId: 'session',
      issuedAt: '2026-07-01T11:59:00.000Z',
      expiresAt: '2026-07-01T12:30:00.000Z',
      correlationId: asCorrelation(),
    };
    let reads = 0;
    const getter = { ...base };
    Object.defineProperty(getter, 'ownerId', {
      enumerable: true,
      get() {
        reads += 1;
        return asOwner();
      },
    });
    expect(sealAuthenticatedMemoryAccess(getter, operationContext(), new Date(NOW))).toBeNull();
    expect(reads).toBe(0);
    expect(
      sealAuthenticatedMemoryAccess(new Proxy(base, {}), operationContext(), new Date(NOW)),
    ).toBeNull();

    const mutable = structuredClone(base);
    const sealed = sealAuthenticatedMemoryAccess(mutable, operationContext(), new Date(NOW));
    expect(sealed).not.toBeNull();
    if (sealed === null) return;
    mutable.roles[0] = 'security-guard';
    mutable.projectScope.permitted[0] = 'security-restricted';
    expect(sealed.role).toBe('personal-assistant');
    expect(sealed.projectScope.permitted).toEqual(['personal']);
    expect(Object.isFrozen(sealed.projectScope.permitted)).toBe(true);

    expect(
      sealAuthenticatedMemoryAccess(
        { ...base, roles: ['personal-assistant', 'personal-assistant'] },
        operationContext(),
        new Date(NOW),
      ),
    ).toBeNull();
  });
});

describe('namespace isolation', () => {
  it.each(['write', 'delete'] as const)(
    'blocks personal mutation from a project role for %s',
    (operation) => {
      expect(
        authorizeMemoryAccess(authenticatedAccess(), operation, {
          ownerId: asOwner(),
          namespace: 'tvoe-vremya',
        }).allowed,
      ).toBe(false);
    },
  );

  it.each(['write', 'delete'] as const)(
    'blocks project mutation from personal for %s',
    (operation) => {
      expect(
        authorizeMemoryAccess(projectAccess('director'), operation, {
          ownerId: asOwner(),
          namespace: 'personal',
        }).allowed,
      ).toBe(false);
    },
  );

  it('allows same-namespace query', () => {
    expect(
      authorizeMemoryAccess(projectAccess('director'), 'query', {
        ownerId: asOwner(),
        namespace: 'tvoe-vremya',
      }),
    ).toEqual({ allowed: true });
  });

  it('isolates security-restricted memory to security-guard', () => {
    const guard = authenticatedAccess({
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
      authorizeMemoryAccess(guard, 'query', { ownerId: asOwner(), namespace: 'tvoe-vremya' })
        .allowed,
    ).toBe(false);
  });

  it('requires cross-project permission for cross-namespace query', () => {
    expect(
      authorizeMemoryAccess(projectAccess('business-analyst'), 'query', {
        ownerId: asOwner(),
        namespace: 'ai-my-time',
      }).allowed,
    ).toBe(false);
    expect(
      authorizeMemoryAccess(projectAccess('business-analyst', true), 'query', {
        ownerId: asOwner(),
        namespace: 'ai-my-time',
      }),
    ).toEqual({ allowed: true });
  });

  it.each(['write', 'delete'] as const)(
    'forbids cross-namespace mutation even with permission for %s',
    (operation) => {
      expect(
        authorizeMemoryAccess(projectAccess('director', true), operation, {
          ownerId: asOwner(),
          namespace: 'ai-my-time',
        }).allowed,
      ).toBe(false);
    },
  );

  it('denies AI Scout memory writes', () => {
    expect(
      authorizeMemoryAccess(projectAccess('ai-scout'), 'write', {
        ownerId: asOwner(),
        namespace: 'tvoe-vremya',
      }).allowed,
    ).toBe(false);
  });

  it('denies delete for roles outside the allowlist', () => {
    expect(
      authorizeMemoryAccess(projectAccess('business-analyst'), 'delete', {
        ownerId: asOwner(),
        namespace: 'tvoe-vremya',
      }).allowed,
    ).toBe(false);
  });

  it('allows director delete inside the active namespace', () => {
    const decision = authorizeMemoryAccess(projectAccess('director'), 'delete', {
      ownerId: asOwner(),
      namespace: 'tvoe-vremya',
    });
    expect(decision).toEqual({ allowed: true });
  });

  it('does not treat record id knowledge as authorization', () => {
    const decision = authorizeMemoryAccess(authenticatedAccess(), 'delete', {
      ownerId: asOwner('other-owner'),
      namespace: 'personal',
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('OWNER_MISMATCH');
    const request = deleteRequest('personal');
    expect(request.recordId).toBe(asRecordId());
    expect(
      authorizeMemoryAccess(projectAccess('director'), 'delete', {
        ownerId: request.expectedOwnerId,
        namespace: request.expectedNamespace,
      }).allowed,
    ).toBe(false);
  });
});

describe('memory access gateway', () => {
  it('creates valid evidence through trusted fake auth and rejects request-level role proof', async () => {
    const harness = createHarness();
    const gateway = createMemoryAccessGateway({
      auth: {
        observe: () =>
          Promise.resolve(
            ok({
              ownerId: asOwner(),
              actorId: asActor(),
              roles: ['personal-assistant'],
              activeNamespace: 'personal',
              projectScope: {
                primary: 'personal',
                permitted: ['personal'],
                crossProjectPermitted: false,
              },
              channelId: 'gateway-channel',
              sessionId: 'gateway-session',
              issuedAt: '2026-07-01T11:59:00.000Z',
              expiresAt: '2026-07-01T12:30:00.000Z',
              correlationId: asCorrelation(),
            }),
          ),
      },
      clock: fixedClock(NOW),
      memory: harness.deps.memory,
      write: {
        scanner: harness.deps.scanner,
        policy: harness.deps.policy,
        approvals: harness.deps.approvals,
        audit: harness.deps.audit,
      },
    });
    const written = await gateway.write({}, writeCommand(), operationContext());
    expect(written.ok).toBe(true);

    const forged = await gateway.write(
      { role: 'security-guard', ownerId: asOwner(), authenticated: true },
      writeCommand(),
      operationContext(),
    );
    // Fake auth ignores request body; observation is trusted composition, not request fields.
    expect(forged.ok).toBe(true);
  });

  it('rejects stale authentication observation', () => {
    const sealed = sealAuthenticatedMemoryAccess(
      {
        ownerId: asOwner(),
        actorId: asActor(),
        roles: ['personal-assistant'],
        activeNamespace: 'personal',
        projectScope: {
          primary: 'personal',
          permitted: ['personal'],
          crossProjectPermitted: false,
        },
        channelId: 'channel',
        sessionId: 'session',
        issuedAt: '2026-07-01T10:00:00.000Z',
        expiresAt: '2026-07-01T10:01:00.000Z',
        correlationId: asCorrelation(),
      },
      operationContext(),
      new Date(NOW),
    );
    expect(sealed).toBeNull();
  });

  it('does not export authenticated context sealers', () => {
    const names = Object.keys(publicApi);
    expect(names).not.toContain('sealAuthenticatedMemoryAccess');
    expect(names).toContain('createMemoryAccessGateway');
    expect(names).not.toContain('authenticatedRegistry');
  });
});
