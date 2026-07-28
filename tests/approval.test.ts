import { describe, expect, it } from 'vitest';
import type { ApprovalDemand } from '../src/core/domain/index.js';
import { classifyEffect, validateApproval } from '../src/core/policy/index.js';
import { computePayloadDigest, executeMemoryWrite } from '../src/core/application/index.js';
import {
  accessContext,
  asActor,
  asDigest,
  asNonce,
  asOwner,
  asResource,
  createHarness,
  grant,
  iso,
  NOW,
  writeCommand,
  asApprovalId,
} from './support/fixtures.js';

const now = new Date(NOW);
const demand = (overrides: Partial<ApprovalDemand> = {}): ApprovalDemand => ({
  ownerId: asOwner(),
  actorId: asActor(),
  effect: 'write',
  target: asResource(),
  payloadDigest: asDigest(),
  nonce: asNonce(),
  ...overrides,
});

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
    ['TARGET_MISMATCH', grant({ target: asResource('memory/other') }), demand()],
    ['PAYLOAD_DIGEST_MISMATCH', grant(), demand({ payloadDigest: asDigest('digest-2') })],
    ['NONCE_MISMATCH', grant(), demand({ nonce: asNonce('nonce-2') })],
    ['EXPIRED', grant({ expiresAt: iso('2026-07-01T11:59:30.000Z') }), demand()],
    ['ALREADY_CONSUMED', grant({ status: 'consumed' }), demand()],
    ['REVOKED', grant({ status: 'revoked' }), demand()],
    ['INVALID_TIMESTAMP', grant({ expiresAt: iso('not-a-timestamp') }), demand()],
    ['INVALID_TIMESTAMP', grant({ payloadDigest: asDigest('') }), demand()],
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

describe('one-time consumption through the memory-write boundary', () => {
  const approvedCommand = writeCommand({
    approval: { approvalId: asApprovalId(), demand: demand() },
  });

  it('consumes a validated grant exactly once', async () => {
    const harness = createHarness({
      policyDecision: { decision: 'approval-required', reason: 'x' },
    });
    const result = await executeMemoryWrite(harness.deps, accessContext(), approvedCommand);
    expect(result.ok).toBe(true);
    expect(harness.calls.filter((call) => call === 'approvals.consume')).toHaveLength(1);
  });

  it('refuses a replayed grant that storage reports as consumed', async () => {
    const harness = createHarness({
      policyDecision: { decision: 'approval-required', reason: 'x' },
      lookupGrant: grant({ status: 'consumed' }),
    });
    const result = await executeMemoryWrite(harness.deps, accessContext(), approvedCommand);
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
    const result = await executeMemoryWrite(harness.deps, accessContext(), approvedCommand);
    expect(result).toEqual({ ok: false, error: { code: 'APPROVAL_UNAVAILABLE' } });
    expect(harness.calls).not.toContain('memory.write');
  });

  it('fails closed when consumption fails', async () => {
    const harness = createHarness({
      policyDecision: { decision: 'approval-required', reason: 'x' },
      consumeFails: true,
    });
    const result = await executeMemoryWrite(harness.deps, accessContext(), approvedCommand);
    expect(result).toEqual({ ok: false, error: { code: 'CONSUMPTION_FAILED' } });
    expect(harness.calls).not.toContain('memory.write');
  });

  it('refuses to proceed when no grant was supplied', async () => {
    const harness = createHarness({
      policyDecision: { decision: 'approval-required', reason: 'x' },
    });
    const result = await executeMemoryWrite(harness.deps, accessContext(), writeCommand());
    expect(result).toEqual({ ok: false, error: { code: 'APPROVAL_REQUIRED' } });
    expect(harness.calls).not.toContain('approvals.lookup');
  });
});
