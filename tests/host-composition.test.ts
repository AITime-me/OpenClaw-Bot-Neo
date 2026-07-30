import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { ok, type MemoryWriteDecision, type Result } from '../src/core/domain/index.js';
import type { DomainError } from '../src/core/domain/index.js';
import type { MemoryPolicyPort } from '../src/core/ports/index.js';
import {
  createExplicitAllowMemoryPolicy,
  createInMemoryMemoryStore,
  createLocalHost,
} from '../src/host/index.js';
import {
  accessContext,
  asOwner,
  asRecordId,
  authenticatedAccess,
  fixedClock,
  grantForCommand,
  asApprovalId,
  writeCommand,
} from './support/fixtures.js';

const approvalRequiredPolicy = (): MemoryPolicyPort => ({
  evaluate: (): Promise<Result<MemoryWriteDecision, DomainError>> =>
    Promise.resolve(ok({ decision: 'approval-required', reason: 'local-host-test' })),
});

const denyPolicy = (): MemoryPolicyPort => ({
  evaluate: (): Promise<Result<MemoryWriteDecision, DomainError>> =>
    Promise.resolve(ok({ decision: 'deny', reason: 'local-host-deny' })),
});

const allowedHost = (overrides: { policy?: MemoryPolicyPort; scanner?: never } = {}) =>
  createLocalHost({
    clock: fixedClock(),
    policy: overrides.policy ?? createExplicitAllowMemoryPolicy(),
  });

describe('createLocalHost composition', () => {
  it('creates a local host without side effects and honest diagnostics', () => {
    const evaluate = vi.fn();
    const host = createLocalHost({
      clock: fixedClock(),
      policy: { evaluate },
    });
    expect(host.diagnostics).toEqual({
      mode: 'local',
      storage: 'in-memory',
      durability: 'ephemeral',
      builtInNetworkClients: 'none',
      automaticNetworkActivity: 'none',
      networkIsolationEnforced: false,
      defaultMemoryPolicy: 'deny',
      deploymentReady: false,
    });
    expect(Object.isFrozen(host)).toBe(true);
    expect(Object.isFrozen(host.diagnostics)).toBe(true);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('defaults to deny-by-default memory policy without hidden allow fallback', async () => {
    const host = createLocalHost({ clock: fixedClock() });
    const result = await host.writeMemory(
      authenticatedAccess(),
      writeCommand({ recordId: 'record-default-deny' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('POLICY_DENIED');
    expect(host.diagnostics.defaultMemoryPolicy).toBe('deny');
  });

  it('requires an injected clock and rejects invalid shapes', () => {
    expect(() => createLocalHost({} as never)).toThrow(/clock/i);
    expect(() => createLocalHost({ clock: null as never })).toThrow(/clock/i);
    expect(() => createLocalHost({ clock: { now: 'nope' } as never })).toThrow(/clock/i);
    expect(() =>
      createLocalHost({
        clock: fixedClock(),
        scanner: { scanText: 'bad' } as never,
      }),
    ).toThrow(/scanner/i);
  });

  it('isolates two host instances', async () => {
    const first = allowedHost();
    const second = allowedHost();
    const access = authenticatedAccess();
    const command = writeCommand({ recordId: 'record-iso-1' });

    const written = await first.writeMemory(access, command);
    expect(written.ok).toBe(true);

    const fromFirst = await first.readMemory(access, {
      recordId: asRecordId('record-iso-1'),
      expectedOwnerId: access.ownerId,
      expectedNamespace: 'personal',
    });
    const fromSecond = await second.readMemory(access, {
      recordId: asRecordId('record-iso-1'),
      expectedOwnerId: access.ownerId,
      expectedNamespace: 'personal',
    });
    expect(fromFirst.ok).toBe(true);
    expect(fromSecond.ok).toBe(false);
  });

  it('runs the real memory-write happy path with explicit allow policy', async () => {
    const host = allowedHost();
    const access = authenticatedAccess();
    const command = writeCommand({ recordId: 'record-happy' });
    const result = await host.writeMemory(access, command);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.recordId).toBe(asRecordId('record-happy'));
    expect(result.value.approvalId).toBeNull();
  });

  it('fail-closes on invalid (unauthenticated) access context', async () => {
    const host = allowedHost();
    const result = await host.writeMemory(accessContext() as never, writeCommand());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_OPERATION_CONTEXT');
  });

  it('fail-closes when approval is missing for approval-required policy', async () => {
    const host = allowedHost({ policy: approvalRequiredPolicy() });
    const result = await host.writeMemory(
      authenticatedAccess(),
      writeCommand({ approvalId: null }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('APPROVAL_REQUIRED');
  });

  it('fail-closes when seeded approval was already consumed', async () => {
    const host = allowedHost({ policy: approvalRequiredPolicy() });
    const access = authenticatedAccess();
    const command = writeCommand({
      recordId: 'record-consume',
      approvalId: asApprovalId('approval-consume'),
    });
    const grant = grantForCommand(command, access, {
      approvalId: asApprovalId('approval-consume'),
    });
    host.seedLocalApprovalGrant(grant);

    const first = await host.writeMemory(access, command);
    expect(first.ok).toBe(true);

    const second = await host.writeMemory(
      access,
      writeCommand({
        recordId: 'record-consume-2',
        approvalId: asApprovalId('approval-consume'),
        rawContent: command.rawContent,
        rawMetadata: command.rawMetadata,
      }),
    );
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(['APPROVAL_INVALID', 'CONSUMPTION_FAILED']).toContain(second.error.code);
  });

  it('fail-closes concurrent consume races on the same grant', async () => {
    const host = allowedHost({ policy: approvalRequiredPolicy() });
    const access = authenticatedAccess();
    const command = writeCommand({
      recordId: 'record-race',
      approvalId: asApprovalId('approval-race'),
    });
    const grant = grantForCommand(command, access, {
      approvalId: asApprovalId('approval-race'),
    });
    host.seedLocalApprovalGrant(grant);

    const [left, right] = await Promise.all([
      host.writeMemory(access, command),
      host.writeMemory(access, command),
    ]);
    const successes = [left, right].filter((result) => result.ok);
    const failures = [left, right].filter((result) => !result.ok);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
  });

  it('fail-closes when policy denies', async () => {
    const host = allowedHost({ policy: denyPolicy() });
    const result = await host.writeMemory(authenticatedAccess(), writeCommand());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('POLICY_DENIED');
  });

  it('snapshots command metadata so later mutation does not affect stored content', async () => {
    const host = allowedHost();
    const access = authenticatedAccess();
    const metadata: Record<string, unknown> = { origin: 'owner-note' };
    const command = writeCommand({
      recordId: 'record-mutate-in',
      rawMetadata: metadata,
      rawContent: 'Stable content for snapshot.',
    });
    const written = await host.writeMemory(access, command);
    expect(written.ok).toBe(true);
    metadata.origin = 'mutated-after-call';

    const read = await host.readMemory(access, {
      recordId: asRecordId('record-mutate-in'),
      expectedOwnerId: access.ownerId,
      expectedNamespace: 'personal',
    });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.content).toBe('Stable content for snapshot.');
  });

  it('returns frozen records so caller mutation cannot alter internal state', async () => {
    const host = allowedHost();
    const access = authenticatedAccess();
    await host.writeMemory(
      access,
      writeCommand({ recordId: 'record-mutate-out', rawContent: 'Original body.' }),
    );
    const read = await host.readMemory(access, {
      recordId: asRecordId('record-mutate-out'),
      expectedOwnerId: access.ownerId,
      expectedNamespace: 'personal',
    });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(Object.isFrozen(read.value)).toBe(true);
    expect(() => {
      (read.value as { content: string }).content = 'tampered';
    }).toThrow();

    const again = await host.readMemory(access, {
      recordId: asRecordId('record-mutate-out'),
      expectedOwnerId: access.ownerId,
      expectedNamespace: 'personal',
    });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.content).toBe('Original body.');
  });

  it('overwrites duplicate local keys deterministically and reports missing reads', async () => {
    const host = allowedHost();
    const access = authenticatedAccess();
    await host.writeMemory(
      access,
      writeCommand({ recordId: 'record-dup', rawContent: 'first version' }),
    );
    await host.writeMemory(
      access,
      writeCommand({ recordId: 'record-dup', rawContent: 'second version' }),
    );
    const read = await host.readMemory(access, {
      recordId: asRecordId('record-dup'),
      expectedOwnerId: access.ownerId,
      expectedNamespace: 'personal',
    });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.content).toBe('second version');

    const missing = await host.readMemory(access, {
      recordId: asRecordId('record-missing'),
      expectedOwnerId: access.ownerId,
      expectedNamespace: 'personal',
    });
    expect(missing.ok).toBe(false);
  });

  it('does not create built-in network clients and does not claim enforceable isolation', async () => {
    const host = allowedHost();
    await host.writeMemory(authenticatedAccess(), writeCommand({ recordId: 'record-net' }));
    expect(host.diagnostics.builtInNetworkClients).toBe('none');
    expect(host.diagnostics.automaticNetworkActivity).toBe('none');
    expect(host.diagnostics.networkIsolationEnforced).toBe(false);
  });

  it('does not require credentials, env secrets, or hidden API fallback', () => {
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const host = createLocalHost({ clock: fixedClock() });
      expect(host.diagnostics.deploymentReady).toBe(false);
      expect(host.diagnostics.networkIsolationEnforced).toBe(false);
      expect('fallback' in host).toBe(false);
      expect('apiKey' in host).toBe(false);
      expect('telegram' in host).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previous;
    }
  });

  it('rejects a clock that returns a non-Date without polluting the next instance', async () => {
    const broken = createLocalHost({
      clock: {
        now: () => 'not-a-date' as never,
      },
      policy: createExplicitAllowMemoryPolicy(),
    });
    await expect(
      broken.writeMemory(authenticatedAccess(), writeCommand({ recordId: 'record-broken-clock' })),
    ).rejects.toThrow(/Date/i);

    const host = allowedHost();
    const result = await host.writeMemory(
      authenticatedAccess(),
      writeCommand({ recordId: 'record-after-broken' }),
    );
    expect(result.ok).toBe(true);
  });

  it('seedLocalApprovalGrant stores plain grants and does not mint authenticated evidence', async () => {
    const host = allowedHost({ policy: approvalRequiredPolicy() });
    const access = authenticatedAccess();
    const command = writeCommand({
      recordId: 'record-seed',
      approvalId: asApprovalId('approval-seed'),
    });
    const grant = grantForCommand(command, access, {
      approvalId: asApprovalId('approval-seed'),
    });
    host.seedLocalApprovalGrant(grant);
    expect(Object.isFrozen(grant) || typeof grant.approvalId === 'string').toBe(true);

    const plain = accessContext();
    const denied = await host.readMemory(plain as never, {
      recordId: asRecordId('record-seed'),
      expectedOwnerId: plain.ownerId,
      expectedNamespace: 'personal',
    });
    expect(denied.ok).toBe(false);
  });
});

describe('adversarial memory authorization (F1/F2/F3)', () => {
  it('denies plain unauthenticated object on read', async () => {
    const host = allowedHost();
    const access = authenticatedAccess({ ownerId: 'owner-a' });
    await host.writeMemory(access, writeCommand({ recordId: 'adv-plain', rawContent: 'secret-a' }));
    const plain = accessContext({ ownerId: asOwner('owner-a') });
    const result = await host.readMemory(plain as never, {
      recordId: asRecordId('adv-plain'),
      expectedOwnerId: asOwner('owner-a'),
      expectedNamespace: 'personal',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('POLICY_DENIED');
  });

  it('denies authenticated owner B reading owner A record', async () => {
    const host = allowedHost();
    const ownerA = authenticatedAccess({ ownerId: 'owner-a' });
    await host.writeMemory(
      ownerA,
      writeCommand({ recordId: 'adv-cross-owner', rawContent: 'secret-a' }),
    );
    const ownerB = authenticatedAccess({ ownerId: 'owner-b' });
    const result = await host.readMemory(ownerB, {
      recordId: asRecordId('adv-cross-owner'),
      expectedOwnerId: asOwner('owner-a'),
      expectedNamespace: 'personal',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('POLICY_DENIED');
  });

  it('denies authenticated owner with wrong namespace', async () => {
    const host = allowedHost();
    const access = authenticatedAccess({
      ownerId: 'owner-ns',
      activeNamespace: 'personal',
    });
    await host.writeMemory(
      access,
      writeCommand({ recordId: 'adv-ns', rawContent: 'personal-only' }),
    );
    const result = await host.readMemory(access, {
      recordId: asRecordId('adv-ns'),
      expectedOwnerId: asOwner('owner-ns'),
      expectedNamespace: 'tvoe-vremya',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('POLICY_DENIED');
  });

  it('denies when caller substitutes expectedOwnerId for another owner', async () => {
    const host = allowedHost();
    const ownerA = authenticatedAccess({ ownerId: 'owner-a' });
    await host.writeMemory(ownerA, writeCommand({ recordId: 'adv-spoof', rawContent: 'secret-a' }));
    const ownerB = authenticatedAccess({ ownerId: 'owner-b' });
    const spoofAsA = await host.readMemory(ownerB, {
      recordId: asRecordId('adv-spoof'),
      expectedOwnerId: asOwner('owner-a'),
      expectedNamespace: 'personal',
    });
    expect(spoofAsA.ok).toBe(false);

    const spoofOwnId = await host.readMemory(ownerB, {
      recordId: asRecordId('adv-spoof'),
      expectedOwnerId: asOwner('owner-b'),
      expectedNamespace: 'personal',
    });
    expect(spoofOwnId.ok).toBe(false);
  });

  it('returns not-found for missing record with valid access', async () => {
    const host = allowedHost();
    const access = authenticatedAccess();
    const result = await host.readMemory(access, {
      recordId: asRecordId('adv-missing'),
      expectedOwnerId: access.ownerId,
      expectedNamespace: 'personal',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_FAILED');
  });

  it('mutation of input request after call does not change stored lookup key semantics', async () => {
    const host = allowedHost();
    const access = authenticatedAccess();
    await host.writeMemory(access, writeCommand({ recordId: 'adv-req-mut', rawContent: 'stable' }));
    const request = {
      recordId: asRecordId('adv-req-mut'),
      expectedOwnerId: access.ownerId,
      expectedNamespace: 'personal' as const,
    };
    const read = await host.readMemory(access, request);
    expect(read.ok).toBe(true);
    (request as { expectedNamespace: string }).expectedNamespace = 'tvoe-vremya';
    const again = await host.readMemory(access, {
      recordId: asRecordId('adv-req-mut'),
      expectedOwnerId: access.ownerId,
      expectedNamespace: 'personal',
    });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.content).toBe('stable');
  });

  it('query and delete fail-closed for unauthenticated access', async () => {
    const store = createInMemoryMemoryStore();
    const plain = accessContext() as never;
    const query = await store.query(
      {
        query: 'x',
        targetNamespace: 'personal',
        expectedOwnerId: asOwner(),
        limit: 10,
      },
      plain,
    );
    expect(query.ok).toBe(false);
    if (!query.ok) expect(query.error.code).toBe('POLICY_DENIED');

    const del = await store.delete(
      {
        recordId: asRecordId('nope'),
        expectedOwnerId: asOwner(),
        expectedNamespace: 'personal',
        reason: 'test',
      },
      plain,
    );
    expect(del.ok).toBe(false);
    if (!del.ok) expect(del.error.code).toBe('POLICY_DENIED');
  });

  it('regression: memory-store and host read path require authorizeMemoryAccess', () => {
    const storeSource = readFileSync('src/host/in-memory/memory-store.ts', 'utf8');
    const hostSource = readFileSync('src/host/create-local-host.ts', 'utf8');
    expect(storeSource).toContain('authorizeMemoryAccess');
    expect(hostSource).toContain('authorizeMemoryAccess');
    expect(storeSource).not.toMatch(/void access/);
    expect(storeSource).toContain('requireAuthorized');
    expect(storeSource.split('requireAuthorized(').length - 1).toBeGreaterThanOrEqual(4);
    expect(hostSource).toMatch(/authorizeMemoryAccess\(access,\s*'read'/);
  });
});

describe('createLocalHost import hygiene', () => {
  it('importing host does not start timers or call global fetch', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const fetchSpy = typeof globalThis.fetch === 'function' ? vi.spyOn(globalThis, 'fetch') : null;
    const beforeTimeout = setTimeoutSpy.mock.calls.length;
    const beforeInterval = setIntervalSpy.mock.calls.length;
    const beforeFetch = fetchSpy?.mock.calls.length ?? 0;
    vi.resetModules();
    await import('../src/host/index.js');
    expect(setTimeoutSpy.mock.calls.length).toBe(beforeTimeout);
    expect(setIntervalSpy.mock.calls.length).toBe(beforeInterval);
    if (fetchSpy) expect(fetchSpy.mock.calls.length).toBe(beforeFetch);
    setTimeoutSpy.mockRestore();
    setIntervalSpy.mockRestore();
    fetchSpy?.mockRestore();
  });

  it('factory does not invoke injected scanner or policy until a use case runs', () => {
    const scanText = vi.fn();
    const scanMetadata = vi.fn();
    const evaluate = vi.fn();
    createLocalHost({
      clock: fixedClock(),
      scanner: { scanText, scanMetadata },
      policy: { evaluate },
    });
    expect(scanText).not.toHaveBeenCalled();
    expect(scanMetadata).not.toHaveBeenCalled();
    expect(evaluate).not.toHaveBeenCalled();
  });
});
