import { describe, expect, it } from 'vitest';
import {
  assertCorrelatedEventPresent,
  assertCorrelatedEventSequence,
  assertMatchingContentConfirmations,
  assertNoCorrelatedEvent,
  findCorrelatedEvent,
} from '../scripts/integration/lib/scenario-orchestration.ts';
import type { ProtocolMessage } from '../scripts/integration/lib/protocol.ts';

const msg = (
  event: ProtocolMessage['event'],
  runId: string,
  role: ProtocolMessage['role'],
  detail?: Record<string, string>,
): ProtocolMessage => ({
  v: 1,
  runId,
  role,
  event,
  pid: 42,
  ...(detail !== undefined ? { detail } : {}),
});

const expectedContent = {
  recordId: 'record-1',
  ownerId: 'owner-1',
  namespace: 'personal',
  contentSha256: 'hash',
};

describe('integration event correlation (R6-L03)', () => {
  const runA = 'run-a';
  const runB = 'run-b';
  const holder = 'holder' as const;

  it('passes exact correlated sequence', () => {
    const messages = [
      msg('READY', runA, holder),
      msg('WRITE_CONFIRMED', runA, holder, expectedContent),
      msg('READ_CONFIRMED', runA, holder, expectedContent),
    ];
    const sequence = assertCorrelatedEventSequence(messages, { runId: runA, role: holder }, [
      'READY',
      'WRITE_CONFIRMED',
      'READ_CONFIRMED',
    ]);
    expect(sequence.pass).toBe(true);
    expect(
      assertMatchingContentConfirmations(messages, expectedContent, { runId: runA, role: holder }),
    ).toBe(true);
  });

  it('fails when same type appears with different runId', () => {
    const messages = [msg('READY', runB, holder)];
    const check = assertCorrelatedEventPresent(messages, {
      event: 'READY',
      runId: runA,
      role: holder,
    });
    expect(check.pass).toBe(false);
    expect(check.detail).toContain('missing correlated event READY');
    expect(check.detail).toContain(runA);
  });

  it('fails when correct runId has wrong lifecycle event', () => {
    const messages = [msg('CLOSED', runA, holder)];
    const check = assertCorrelatedEventPresent(messages, {
      event: 'READY',
      runId: runA,
      role: holder,
    });
    expect(check.pass).toBe(false);
  });

  it('fails when correlated events appear in wrong order', () => {
    const messages = [
      msg('READ_CONFIRMED', runA, holder, expectedContent),
      msg('WRITE_CONFIRMED', runA, holder, expectedContent),
    ];
    const sequence = assertCorrelatedEventSequence(messages, { runId: runA, role: holder }, [
      'WRITE_CONFIRMED',
      'READ_CONFIRMED',
    ]);
    expect(sequence.pass).toBe(false);
    expect(sequence.detail).toContain('READ_CONFIRMED');
  });

  it('fails when unrelated earlier event cannot satisfy later assertion', () => {
    const messages = [
      msg('READY', runB, 'normal'),
      msg('WRITE_CONFIRMED', runA, holder, expectedContent),
    ];
    expect(
      assertMatchingContentConfirmations(messages, expectedContent, { runId: runA, role: holder }),
    ).toBe(false);
  });

  it('duplicate events do not hide missing order or correlation', () => {
    const messages = [
      msg('READY', runA, holder),
      msg('READY', runA, holder),
      msg('WRITE_CONFIRMED', runB, holder, expectedContent),
    ];
    const sequence = assertCorrelatedEventSequence(messages, { runId: runA, role: holder }, [
      'READY',
      'WRITE_CONFIRMED',
    ]);
    expect(sequence.pass).toBe(false);
    expect(sequence.detail).toContain('WRITE_CONFIRMED');
  });

  it('failure message identifies exact missing expectation', () => {
    const check = assertNoCorrelatedEvent([msg('FAILED', runA, holder)], {
      event: 'FAILED',
      runId: runA,
      role: holder,
    });
    expect(check.pass).toBe(false);
    expect(check.detail).toContain('unexpected correlated event FAILED');
    expect(
      findCorrelatedEvent([msg('READY', runA, holder)], {
        event: 'READY',
        runId: runA,
        role: holder,
      }),
    ).toBeDefined();
  });
});
