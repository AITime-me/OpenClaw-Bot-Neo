import { GateAbortedError } from './cleanup-controller.ts';
import type { ProtocolEvent } from './constants.ts';
import type { ProtocolMessage } from './protocol.ts';

export type EventWaitFailureCode =
  | 'FAILED_EVENT'
  | 'UNEXPECTED_EVENT'
  | 'UNEXPECTED_TERMINAL'
  | 'CHILD_EXITED'
  | 'CHILD_CLOSED'
  | 'TIMED_OUT'
  | 'ABORTED'
  | 'PROTOCOL_ERROR'
  | 'STREAM_CLOSED'
  | 'WAITER_CONFLICT'
  | 'PARTIAL_LINE';

export type EventStreamCloseReason = {
  readonly code: EventWaitFailureCode;
  readonly exitCode?: number | null;
  readonly signal?: string | null;
  readonly protocolError?: string;
  readonly timedOut?: boolean;
};

export class ProtocolEventWaitError extends Error {
  readonly code: EventWaitFailureCode;
  readonly expectedEvent: ProtocolEvent | undefined;
  readonly observedEvent: ProtocolEvent | undefined;
  readonly observedErrorCode: string | undefined;
  readonly exitCode: number | null | undefined;
  readonly signal: string | null | undefined;
  readonly protocolError: string | undefined;
  readonly terminalSeen: boolean;

  constructor(options: {
    readonly code: EventWaitFailureCode;
    readonly message: string;
    readonly expectedEvent?: ProtocolEvent;
    readonly observedEvent?: ProtocolEvent;
    readonly observedErrorCode?: string;
    readonly exitCode?: number | null;
    readonly signal?: string | null;
    readonly protocolError?: string;
    readonly terminalSeen?: boolean;
  }) {
    super(options.message);
    this.name = 'ProtocolEventWaitError';
    this.code = options.code;
    this.expectedEvent = options.expectedEvent;
    this.observedEvent = options.observedEvent;
    this.observedErrorCode = options.observedErrorCode;
    this.exitCode = options.exitCode;
    this.signal = options.signal;
    this.protocolError = options.protocolError;
    this.terminalSeen = options.terminalSeen === true;
  }
}

type PendingWaiter = {
  readonly resolve: (message: ProtocolMessage) => void;
  readonly reject: (error: Error) => void;
  readonly abortListener: (() => void) | null;
  readonly signal: AbortSignal | undefined;
};

const isTerminalEvent = (event: ProtocolEvent): boolean =>
  event === 'FAILED' || event === 'CLOSED' || event === 'HELD';

/**
 * Ordered single-consumer protocol event stream.
 * Events are never skipped; waiters settle on next event, close, timeout, or abort.
 */
export class ProtocolEventStream {
  private readonly queue: ProtocolMessage[] = [];
  private waiter: PendingWaiter | null = null;
  private closed = false;
  private closeReason: EventStreamCloseReason | null = null;
  private terminalSeen = false;

  pendingWaiterCount(): number {
    return this.waiter === null ? 0 : 1;
  }

  bufferedCount(): number {
    return this.queue.length;
  }

  isClosed(): boolean {
    return this.closed;
  }

  hasTerminal(): boolean {
    return this.terminalSeen;
  }

  /**
   * Push one protocol message in arrival order.
   * Delivers immediately to a pending waiter, otherwise buffers.
   */
  push(message: ProtocolMessage): void {
    if (isTerminalEvent(message.event)) {
      this.terminalSeen = true;
    }
    if (this.waiter !== null) {
      const pending = this.waiter;
      this.clearWaiter();
      pending.resolve(message);
      return;
    }
    this.queue.push(message);
  }

  /**
   * Close the stream (idempotent). Rejects any pending waiter.
   * Buffered events remain consumable until drained.
   */
  close(reason: EventStreamCloseReason): void {
    if (this.closed) return;
    this.closed = true;
    this.closeReason = reason;
    if (this.waiter !== null) {
      const pending = this.waiter;
      this.clearWaiter();
      pending.reject(this.buildCloseError(reason, undefined));
    }
  }

  /** Wait for the next event in arrival order (no type filtering). */
  waitForNextProtocolEvent(signal?: AbortSignal): Promise<ProtocolMessage> {
    if (signal?.aborted) {
      return Promise.reject(new GateAbortedError('aborted'));
    }
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next === undefined) {
        return Promise.reject(
          new ProtocolEventWaitError({
            code: 'STREAM_CLOSED',
            message: 'Event queue empty unexpectedly.',
            terminalSeen: this.terminalSeen,
          }),
        );
      }
      return Promise.resolve(next);
    }
    if (this.closed) {
      return Promise.reject(
        this.buildCloseError(this.closeReason ?? { code: 'STREAM_CLOSED' }, undefined),
      );
    }
    if (this.waiter !== null) {
      return Promise.reject(
        new ProtocolEventWaitError({
          code: 'WAITER_CONFLICT',
          message: 'Only one protocol event waiter is allowed at a time.',
          terminalSeen: this.terminalSeen,
        }),
      );
    }
    return new Promise<ProtocolMessage>((resolve, reject) => {
      let abortListener: (() => void) | null = null;
      if (signal !== undefined) {
        abortListener = (): void => {
          if (this.waiter === null) return;
          this.clearWaiter();
          reject(new GateAbortedError('aborted'));
        };
      }
      this.waiter = { resolve, reject, abortListener, signal };
      // Close registration race: abort may have fired between the pre-check and waiter store.
      if (signal !== undefined && abortListener !== null) {
        signal.addEventListener('abort', abortListener, { once: true });
        if (signal.aborted) {
          this.clearWaiter();
          reject(new GateAbortedError('aborted'));
        }
      }
    });
  }

  /**
   * Consume the very next event and require exact type.
   * FAILED / unexpected terminal / mismatch fail immediately (event is consumed).
   */
  async expectNextEvent(expected: ProtocolEvent, signal?: AbortSignal): Promise<ProtocolMessage> {
    if (signal?.aborted) {
      throw new GateAbortedError('aborted');
    }
    const message = await this.waitForNextProtocolEvent(signal);
    if (message.event === expected) {
      return message;
    }
    if (message.event === 'FAILED') {
      throw new ProtocolEventWaitError({
        code: 'FAILED_EVENT',
        message: 'Received FAILED while waiting for protocol event.',
        expectedEvent: expected,
        observedEvent: 'FAILED',
        ...(typeof message.errorCode === 'string' ? { observedErrorCode: message.errorCode } : {}),
        terminalSeen: true,
      });
    }
    if (isTerminalEvent(message.event)) {
      throw new ProtocolEventWaitError({
        code: 'UNEXPECTED_TERMINAL',
        message: `Received unexpected terminal event ${message.event}.`,
        expectedEvent: expected,
        observedEvent: message.event,
        ...(typeof message.errorCode === 'string' ? { observedErrorCode: message.errorCode } : {}),
        terminalSeen: true,
      });
    }
    throw new ProtocolEventWaitError({
      code: 'UNEXPECTED_EVENT',
      message: `Received unexpected event ${message.event}.`,
      expectedEvent: expected,
      observedEvent: message.event,
      ...(typeof message.errorCode === 'string' ? { observedErrorCode: message.errorCode } : {}),
      terminalSeen: this.terminalSeen,
    });
  }

  private clearWaiter(): void {
    if (this.waiter?.abortListener !== null && this.waiter?.signal !== undefined) {
      this.waiter.signal.removeEventListener('abort', this.waiter.abortListener);
    }
    this.waiter = null;
  }

  private buildCloseError(
    reason: EventStreamCloseReason,
    expectedEvent: ProtocolEvent | undefined,
  ): Error {
    if (reason.code === 'ABORTED') {
      return new GateAbortedError(reason.protocolError ?? 'aborted');
    }
    const code: EventWaitFailureCode = reason.timedOut === true ? 'TIMED_OUT' : reason.code;
    return new ProtocolEventWaitError({
      code,
      message: `Protocol event stream closed (${code}).`,
      ...(expectedEvent !== undefined ? { expectedEvent } : {}),
      ...(reason.exitCode !== undefined ? { exitCode: reason.exitCode } : {}),
      ...(reason.signal !== undefined ? { signal: reason.signal } : {}),
      ...(reason.protocolError !== undefined ? { protocolError: reason.protocolError } : {}),
      terminalSeen: this.terminalSeen,
    });
  }
}

export const createProtocolEventStream = (): ProtocolEventStream => new ProtocolEventStream();
