import { describe, expect, it } from 'vitest';
import type { ApprovalDemand, MemoryNamespace, ProjectScope } from '../src/core/domain/index.js';
import { classifyEffect, validateApproval } from '../src/core/policy/index.js';
import { computePayloadDigest, executeMemoryWrite } from '../src/core/application/index.js';
import {
  deriveMemoryWriteApprovalDemand,
  memoryWriteTarget,
} from '../src/core/application/memory-write.service.js';
import { sealSanitizedMetadata, sealSanitizedText } from '../src/core/domain/sanitized.internal.js';
import * as publicApi from '../src/index.js';
import {
  authenticatedAccess,
  asActor,
  asApprovalId,
  asDigest,
  asOwner,
  asRecordId,
  asResource,
  createHarness,
  fixedClock,
  grant,
  grantForCommand,
  iso,
  NOW,
  projectScope,
  writeCommand,
} from './support/fixtures.js';

const now = new Date(NOW);
const demand = (overrides: Partial<ApprovalDemand> = {}): ApprovalDemand => ({
  ownerId: asOwner(),
  actorId: asActor(),
  effect: 'write',
  target: memoryWriteTarget('personal', asRecordId()),
  namespace: 'personal',
  projectScope: projectScope(),
  payloadDigest: asDigest(),
  ...overrides,
});
const malformedGrant = (changes: Record<string, unknown>) => {
  const candidate = grant();
  Object.assign(candidate, changes);
  return candidate;
};

describe('effect classification', () => {
  it('allows read, forbids payment and denies an unknown effect', () => {
    expect(classifyEffect('read')).toEqual({ decision: 'allow' });
    expect(classifyEffect('payment').decision).toBe('deny');
    expect(classifyEffect('teleport').decision).toBe('deny');
    expect(classifyEffect('external-send')).toEqual({
      decision: 'approval-required',
      effect: 'external-send',
    });
  });
});

describe('scoped approval validation', () => {
  it('accepts an exact match', () => {
    const result = validateApproval(grant(), demand(), now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.approvalId).toBe(asApprovalId());
  });

  it.each([
    ['MISSING_GRANT', null, demand()],
    ['OWNER_MISMATCH', grant({ ownerId: asOwner('owner-2') }), demand()],
    ['ACTOR_MISMATCH', grant({ actorId: asActor('actor-2') }), demand()],
    ['EFFECT_MISMATCH', grant({ effect: 'delete' }), demand()],
    ['TARGET_MISMATCH', grant({ target: asResource('memory/tvoe-vremya/record') }), demand()],
    ['NAMESPACE_MISMATCH', grant({ namespace: 'tvoe-vremya' }), demand()],
    [
      'PROJECT_SCOPE_MISMATCH',
      grant({
        projectScope: projectScope({
          primary: 'tvoe-vremya',
          permitted: ['tvoe-vremya'],
        } satisfies Partial<ProjectScope>),
      }),
      demand(),
    ],
    ['PAYLOAD_DIGEST_MISMATCH', grant(), demand({ payloadDigest: asDigest('b'.repeat(64)) })],
    ['EXPIRED', grant({ expiresAt: iso('2026-07-01T11:59:30.000Z') }), demand()],
    ['ALREADY_CONSUMED', grant({ status: 'consumed' }), demand()],
    ['REVOKED', grant({ status: 'revoked' }), demand()],
    ['INVALID_TIMESTAMP', malformedGrant({ expiresAt: 'not-a-timestamp' }), demand()],
    ['MALFORMED_GRANT', malformedGrant({ payloadDigest: '' }), demand()],
  ] as const)('refuses with %s', (code, candidate, attempted) => {
    const result = validateApproval(candidate, attempted, now);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(code);
  });

  it('treats an effect outside the approvable set as unknown', () => {
    const result = validateApproval(
      grant({ effect: 'payment' as unknown as 'write' }),
      demand(),
      now,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('UNKNOWN_EFFECT');
  });

  it('binds the digest to the payload and ignores key order', () => {
    const first = computePayloadDigest({ content: 'a', namespace: 'personal' });
    const reordered = computePayloadDigest({ namespace: 'personal', content: 'a' });
    const changed = computePayloadDigest({ content: 'b', namespace: 'personal' });
    expect(first).toBe(reordered);
    expect(first).not.toBe(changed);
    const bound = grant({ payloadDigest: first });
    expect(validateApproval(bound, demand({ payloadDigest: first }), now).ok).toBe(true);
    expect(validateApproval(bound, demand({ payloadDigest: changed }), now).ok).toBe(false);
  });

  it('rejects executable grant shapes and seals the validated nonce snapshot', () => {
    let reads = 0;
    const getter = grant();
    Object.defineProperty(getter, 'ownerId', {
      enumerable: true,
      get() {
        reads += 1;
        return asOwner();
      },
    });
    expect(validateApproval(getter, demand(), now).ok).toBe(false);
    expect(reads).toBe(0);
    expect(validateApproval(new Proxy(grant(), {}), demand(), now).ok).toBe(false);

    const permitted: MemoryNamespace[] = ['personal'];
    const mutable = grant({ projectScope: projectScope({ permitted }) });
    const validated = validateApproval(mutable, demand(), now);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const originalNonce = validated.value.nonce;
    Object.assign(mutable, { nonce: 'changed-nonce' });
    permitted[0] = 'security-restricted';
    expect(validated.value.nonce).toBe(originalNonce);
    expect(Object.isFrozen(validated.value)).toBe(true);
  });

  it('refuses a cyclic or excessively nested payload without echoing it', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' };
    cyclic.self = cyclic;
    expect(() => computePayloadDigest(cyclic)).toThrow(/cycle/i);

    let deep: Record<string, unknown> = { leaf: 'secret-value' };
    for (let level = 0; level < 20; level += 1) deep = { nested: deep };
    try {
      computePayloadDigest(deep);
      expect.unreachable('a payload nested past the limit must be refused');
    } catch (error) {
      expect(String(error)).not.toContain('secret-value');
    }
  });
});

describe('approval binding to the actual memory operation', () => {
  it('builds demand from the authenticated context and sanitized payload', () => {
    const access = authenticatedAccess();
    const command = writeCommand({ rawContent: 'payload-a', rawMetadata: { tag: 'one' } });
    const recordId = asRecordId(command.recordId);
    const derived = deriveMemoryWriteApprovalDemand({
      access,
      targetNamespace: command.targetNamespace,
      recordId,
      content: sealSanitizedText(command.rawContent, 'allow'),
      metadata: sealSanitizedMetadata({ tag: 'one' }, 'allow'),
      projectScope: access.projectScope,
    });
    expect(derived.ownerId).toBe(access.ownerId);
    expect(derived.actorId).toBe(access.actorId);
    expect(derived.namespace).toBe('personal');
    expect(derived.target).toBe(memoryWriteTarget('personal', recordId));
    expect(Object.keys(derived)).not.toContain('nonce');
  });

  it('includes metadata in the digest so metadata changes invalidate the grant', () => {
    const access = authenticatedAccess();
    const left = deriveMemoryWriteApprovalDemand({
      access,
      targetNamespace: 'personal',
      recordId: asRecordId(),
      content: sealSanitizedText('same', 'allow'),
      metadata: sealSanitizedMetadata({ a: '1' }, 'allow'),
      projectScope: access.projectScope,
    });
    const right = deriveMemoryWriteApprovalDemand({
      access,
      targetNamespace: 'personal',
      recordId: asRecordId(),
      content: sealSanitizedText('same', 'allow'),
      metadata: sealSanitizedMetadata({ a: '2' }, 'allow'),
      projectScope: access.projectScope,
    });
    expect(left.payloadDigest).not.toBe(right.payloadDigest);
  });

  it('rejects a grant issued for payload A when writing payload B', async () => {
    const commandA = writeCommand({ rawContent: 'payload-a' });
    const commandB = writeCommand({
      rawContent: 'payload-b',
      approvalId: asApprovalId(),
    });
    const harness = createHarness({
      policyDecision: { decision: 'approval-required', reason: 'x' },
      lookupGrant: grantForCommand(commandA),
    });
    const result = await executeMemoryWrite(harness.deps, authenticatedAccess(), commandB);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toEqual({
        code: 'APPROVAL_INVALID',
        reason: 'PAYLOAD_DIGEST_MISMATCH',
      });
    expect(harness.calls).not.toContain('memory.write');
    expect(JSON.stringify(result)).not.toContain('payload-a');
    expect(JSON.stringify(result)).not.toContain('payload-b');
  });

  it.each([
    ['OWNER_MISMATCH', { ownerId: asOwner('owner-2') }],
    ['ACTOR_MISMATCH', { actorId: asActor('actor-2') }],
    ['EFFECT_MISMATCH', { effect: 'delete' as const }],
    ['TARGET_MISMATCH', { target: asResource('memory/personal/other') }],
    ['NAMESPACE_MISMATCH', { namespace: 'tvoe-vremya' as const }],
    [
      'PROJECT_SCOPE_MISMATCH',
      {
        projectScope: projectScope({ primary: 'tvoe-vremya', permitted: ['tvoe-vremya'] }),
      },
    ],
  ])('rejects grant with %s against the actual operation', async (code, override) => {
    const command = writeCommand({ approvalId: asApprovalId() });
    const harness = createHarness({
      policyDecision: { decision: 'approval-required', reason: 'x' },
      lookupGrant: grantForCommand(command, authenticatedAccess(), override),
    });
    const result = await executeMemoryWrite(harness.deps, authenticatedAccess(), command);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ code: 'APPROVAL_INVALID', reason: code });
    expect(harness.calls).not.toContain('memory.write');
    expect(harness.calls).not.toContain('audit.record');
  });

  it('rejects an expired grant using the trusted clock, not a caller timestamp', async () => {
    const command = writeCommand({ approvalId: asApprovalId() });
    const harness = createHarness({
      policyDecision: { decision: 'approval-required', reason: 'x' },
      lookupGrant: grantForCommand(command),
      clock: fixedClock('2026-07-01T13:00:00.000Z'),
    });
    const result = await executeMemoryWrite(harness.deps, authenticatedAccess(), command);
    expect(result).toEqual({
      ok: false,
      error: { code: 'APPROVAL_INVALID', reason: 'EXPIRED' },
    });
    expect(harness.calls).not.toContain('memory.write');
  });

  it('does not accept a caller-supplied demand or now field on the command', () => {
    const command = writeCommand({ approvalId: asApprovalId() });
    expect(command).not.toHaveProperty('now');
    expect(command).not.toHaveProperty('demand');
    expect(command).not.toHaveProperty('approval');
    expect(Object.keys(command)).toContain('approvalId');
  });

  it('consumes a validated grant exactly once', async () => {
    const command = writeCommand({ approvalId: asApprovalId() });
    const harness = createHarness({
      policyDecision: { decision: 'approval-required', reason: 'x' },
      lookupGrant: grantForCommand(command),
    });
    const result = await executeMemoryWrite(harness.deps, authenticatedAccess(), command);
    expect(result.ok).toBe(true);
    expect(harness.calls.filter((call) => call === 'approvals.consume')).toHaveLength(1);
  });

  it('refuses a replayed grant that storage reports as consumed', async () => {
    const command = writeCommand({ approvalId: asApprovalId() });
    const harness = createHarness({
      policyDecision: { decision: 'approval-required', reason: 'x' },
      lookupGrant: grantForCommand(command, authenticatedAccess(), { status: 'consumed' }),
    });
    const result = await executeMemoryWrite(harness.deps, authenticatedAccess(), command);
    expect(result).toEqual({
      ok: false,
      error: { code: 'APPROVAL_INVALID', reason: 'ALREADY_CONSUMED' },
    });
    expect(harness.calls).not.toContain('memory.write');
  });

  it('fails closed when approval storage is unavailable', async () => {
    const harness = createHarness({
      policyDecision: { decision: 'approval-required', reason: 'x' },
      lookupFails: true,
    });
    const result = await executeMemoryWrite(
      harness.deps,
      authenticatedAccess(),
      writeCommand({ approvalId: asApprovalId() }),
    );
    expect(result).toEqual({ ok: false, error: { code: 'APPROVAL_UNAVAILABLE' } });
    expect(harness.calls).not.toContain('memory.write');
  });

  it('fails closed when consumption fails', async () => {
    const command = writeCommand({ approvalId: asApprovalId() });
    const harness = createHarness({
      policyDecision: { decision: 'approval-required', reason: 'x' },
      lookupGrant: grantForCommand(command),
      consumeFails: true,
    });
    const result = await executeMemoryWrite(harness.deps, authenticatedAccess(), command);
    expect(result).toEqual({ ok: false, error: { code: 'CONSUMPTION_FAILED' } });
    expect(harness.calls).not.toContain('memory.write');
  });

  it('simulates concurrent consume so only one attempt can succeed', async () => {
    const command = writeCommand({ approvalId: asApprovalId() });
    const matching = grantForCommand(command);
    const first = createHarness({
      policyDecision: { decision: 'approval-required', reason: 'x' },
      lookupGrant: matching,
      concurrentConsume: true,
    });
    const second = createHarness({
      policyDecision: { decision: 'approval-required', reason: 'x' },
      lookupGrant: matching,
      concurrentConsume: true,
    });
    // Shared consume counter through a single harness-like port:
    let consumeCount = 0;
    const sharedConsume = () => {
      consumeCount += 1;
      return Promise.resolve(
        consumeCount === 1
          ? { ok: true as const, value: undefined }
          : {
              ok: false as const,
              error: {
                code: 'EXTERNAL_FAILURE' as const,
                operation: 'consume',
                retryable: false,
              },
            },
      );
    };
    first.deps.approvals.consume = sharedConsume;
    second.deps.approvals.consume = sharedConsume;
    const [a, b] = await Promise.all([
      executeMemoryWrite(first.deps, authenticatedAccess(), command),
      executeMemoryWrite(second.deps, authenticatedAccess(), command),
    ]);
    const successes = [a, b].filter((result) => result.ok);
    expect(successes).toHaveLength(1);
    expect(consumeCount).toBe(2);
  });

  it('refuses to proceed when no approvalId was supplied', async () => {
    const harness = createHarness({
      policyDecision: { decision: 'approval-required', reason: 'x' },
    });
    const result = await executeMemoryWrite(harness.deps, authenticatedAccess(), writeCommand());
    expect(result).toEqual({ ok: false, error: { code: 'APPROVAL_REQUIRED' } });
    expect(harness.calls).not.toContain('approvals.lookup');
  });

  it('does not export approval or clock bypasses from the public API', () => {
    const names = Object.keys(publicApi);
    for (const forbidden of [
      'sealValidatedApproval',
      'validatedApprovalBrand',
      'deriveMemoryWriteApprovalDemand',
      'readTrustedTimestamp',
      'fixedClock',
      'sealSanitizedText',
      'sealSanitizedMetadata',
    ])
      expect(names).not.toContain(forbidden);
  });
});
