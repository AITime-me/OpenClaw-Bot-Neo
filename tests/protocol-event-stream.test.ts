import { describe, expect, it } from 'vitest';
import { GateAbortedError } from '../scripts/integration/lib/cleanup-controller.ts';
import type { ProtocolEvent } from '../scripts/integration/lib/constants.ts';
import {
  createProtocolEventStream,
  ProtocolEventWaitError,
} from '../scripts/integration/lib/protocol-event-stream.ts';
import type { ProtocolMessage } from '../scripts/integration/lib/protocol.ts';

const msg = (event: ProtocolEvent, extra?: Partial<ProtocolMessage>): ProtocolMessage => ({
  v: 1,
  runId: 'r',
  role: 'holder',
  event,
  pid: 1,
  ...extra,
});

const bound = async <T>(promise: Promise<T>, ms = 400): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('TEST_HANG'));
        }, ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

describe('H1 protocol event stream', () => {
  it('matching event resolves', async () => {
    const stream = createProtocolEventStream();
    const pending = stream.expectNextEvent('READY');
    stream.push(msg('READY'));
    await expect(bound(pending)).resolves.toMatchObject({ event: 'READY' });
    expect(stream.pendingWaiterCount()).toBe(0);
  });

  it('buffered event before waiter resolves', async () => {
    const stream = createProtocolEventStream();
    stream.push(msg('READY'));
    await expect(bound(stream.expectNextEvent('READY'))).resolves.toMatchObject({
      event: 'READY',
    });
  });

  it('FAILED while waiting another event rejects immediately', async () => {
    const stream = createProtocolEventStream();
    const pending = stream.expectNextEvent('WRITE_CONFIRMED');
    stream.push(msg('FAILED', { errorCode: 'WRITE_FAILED' }));
    await expect(bound(pending)).rejects.toMatchObject({
      name: 'ProtocolEventWaitError',
      code: 'FAILED_EVENT',
      observedErrorCode: 'WRITE_FAILED',
      expectedEvent: 'WRITE_CONFIRMED',
    });
    expect(stream.pendingWaiterCount()).toBe(0);
  });

  it('CLOSED while waiting READ rejects immediately', async () => {
    const stream = createProtocolEventStream();
    const pending = stream.expectNextEvent('READ_CONFIRMED');
    stream.push(msg('CLOSED'));
    await expect(bound(pending)).rejects.toMatchObject({
      code: 'UNEXPECTED_TERMINAL',
      observedEvent: 'CLOSED',
    });
  });

  it('HELD while waiting READY rejects', async () => {
    const stream = createProtocolEventStream();
    const pending = stream.expectNextEvent('READY');
    stream.push(msg('HELD'));
    await expect(bound(pending)).rejects.toMatchObject({
      code: 'UNEXPECTED_TERMINAL',
      observedEvent: 'HELD',
    });
  });

  it('arbitrary out-of-order non-terminal event rejects', async () => {
    const stream = createProtocolEventStream();
    const pending = stream.expectNextEvent('WRITE_CONFIRMED');
    stream.push(msg('READ_CONFIRMED'));
    await expect(bound(pending)).rejects.toMatchObject({
      code: 'UNEXPECTED_EVENT',
      observedEvent: 'READ_CONFIRMED',
    });
  });

  it('child exit before event rejects', async () => {
    const stream = createProtocolEventStream();
    const pending = stream.expectNextEvent('READY');
    stream.close({ code: 'CHILD_EXITED', exitCode: 1, signal: 'SIGTERM' });
    const error = await bound(pending).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProtocolEventWaitError);
    expect(error).toMatchObject({
      code: 'CHILD_EXITED',
      exitCode: 1,
      signal: 'SIGTERM',
    });
    expect(stream.pendingWaiterCount()).toBe(0);
  });

  it('child close before event rejects', async () => {
    const stream = createProtocolEventStream();
    const pending = stream.expectNextEvent('WRITE_CONFIRMED');
    stream.close({ code: 'CHILD_CLOSED', exitCode: 0, signal: null });
    await expect(bound(pending)).rejects.toMatchObject({ code: 'CHILD_CLOSED' });
  });

  it('timeout rejects pending waiter immediately', async () => {
    const stream = createProtocolEventStream();
    const pending = stream.expectNextEvent('READY');
    stream.close({ code: 'TIMED_OUT', timedOut: true });
    await expect(bound(pending)).rejects.toMatchObject({ code: 'TIMED_OUT' });
  });

  it('abort rejects pending waiter', async () => {
    const stream = createProtocolEventStream();
    const ac = new AbortController();
    const pending = stream.expectNextEvent('READY', ac.signal);
    ac.abort();
    await expect(bound(pending)).rejects.toBeInstanceOf(GateAbortedError);
    expect(stream.pendingWaiterCount()).toBe(0);
  });

  it('abort before registration rejects immediately', async () => {
    const stream = createProtocolEventStream();
    const ac = new AbortController();
    ac.abort();
    await expect(bound(stream.expectNextEvent('READY', ac.signal))).rejects.toBeInstanceOf(
      GateAbortedError,
    );
  });

  it('multiple pending waiters are prohibited', async () => {
    const stream = createProtocolEventStream();
    const first = stream.waitForNextProtocolEvent();
    await expect(bound(stream.waitForNextProtocolEvent())).rejects.toMatchObject({
      code: 'WAITER_CONFLICT',
    });
    stream.close({ code: 'CHILD_CLOSED', exitCode: 1 });
    await expect(bound(first)).rejects.toMatchObject({ code: 'CHILD_CLOSED' });
    expect(stream.pendingWaiterCount()).toBe(0);
  });

  it('exit+close settle waiter once', async () => {
    const stream = createProtocolEventStream();
    const pending = stream.expectNextEvent('READY');
    stream.close({ code: 'CHILD_EXITED', exitCode: 7, signal: null });
    stream.close({ code: 'CHILD_CLOSED', exitCode: 7, signal: null });
    await expect(bound(pending)).rejects.toMatchObject({ code: 'CHILD_EXITED' });
    expect(stream.pendingWaiterCount()).toBe(0);
  });

  it('timeout+close settle once', async () => {
    const stream = createProtocolEventStream();
    const pending = stream.expectNextEvent('READY');
    stream.close({ code: 'TIMED_OUT', timedOut: true });
    stream.close({ code: 'CHILD_CLOSED', exitCode: null, signal: 'SIGTERM' });
    await expect(bound(pending)).rejects.toMatchObject({ code: 'TIMED_OUT' });
  });

  it('event after failure does not revive waiter', async () => {
    const stream = createProtocolEventStream();
    const pending = stream.expectNextEvent('READY');
    stream.close({ code: 'TIMED_OUT', timedOut: true });
    await expect(bound(pending)).rejects.toMatchObject({ code: 'TIMED_OUT' });
    stream.push(msg('READY'));
    expect(stream.pendingWaiterCount()).toBe(0);
    // Buffered after close remains consumable; next wait gets READY then can continue.
    await expect(bound(stream.waitForNextProtocolEvent())).resolves.toMatchObject({
      event: 'READY',
    });
  });

  it('no waiter leak after settlement', async () => {
    const stream = createProtocolEventStream();
    stream.push(msg('READY'));
    await stream.expectNextEvent('READY');
    expect(stream.pendingWaiterCount()).toBe(0);
    expect(stream.bufferedCount()).toBe(0);
  });

  it('consumes multiple events from one logical chunk in order', async () => {
    const stream = createProtocolEventStream();
    stream.push(msg('READY'));
    stream.push(msg('WRITE_CONFIRMED'));
    await expect(bound(stream.expectNextEvent('READY'))).resolves.toMatchObject({
      event: 'READY',
    });
    await expect(bound(stream.expectNextEvent('WRITE_CONFIRMED'))).resolves.toMatchObject({
      event: 'WRITE_CONFIRMED',
    });
  });

  it('does not skip intervening unexpected event to find a later match', async () => {
    const stream = createProtocolEventStream();
    stream.push(msg('FAILED', { errorCode: 'X' }));
    stream.push(msg('WRITE_CONFIRMED'));
    await expect(bound(stream.expectNextEvent('WRITE_CONFIRMED'))).rejects.toMatchObject({
      code: 'FAILED_EVENT',
    });
    // WRITE_CONFIRMED remains next in buffer — not silently matched across FAILED.
    await expect(bound(stream.waitForNextProtocolEvent())).resolves.toMatchObject({
      event: 'WRITE_CONFIRMED',
    });
  });
});
