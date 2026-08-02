type CleanupFn = () => Promise<void> | void;

export type CleanupController = {
  readonly registerSignalHandlers: (cleanupFn: CleanupFn) => void;
  readonly runCleanupOnce: () => Promise<void>;
  readonly wasInterruptedBySignal: () => boolean;
  readonly isAborted: () => boolean;
  readonly abortReason: () => string | null;
  readonly getAbortSignal: () => AbortSignal;
  readonly restoreHandlers: () => void;
  /** Pure-test seam: mark interrupted without emitting OS signals. */
  readonly markInterruptedForTests: (reason?: string) => void;
  /** Throw if aborted — used by scenario orchestration. */
  readonly throwIfAborted: () => void;
};

export class GateAbortedError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`Gate aborted: ${reason}`);
    this.name = 'GateAbortedError';
    this.reason = reason;
  }
}

export const createCleanupController = (): CleanupController => {
  let cleanupFn: CleanupFn | null = null;
  let cleanupLatch = false;
  let interruptedBySignal = false;
  let abortReasonValue: string | null = null;
  const abortController = new AbortController();

  const signalHandlers: Array<{ signal: NodeJS.Signals; listener: () => void }> = [];
  let onUncaughtException: ((error: Error) => void) | null = null;
  let onUnhandledRejection: ((reason: unknown) => void) | null = null;

  const markAborted = (reason: string): void => {
    if (abortReasonValue === null) {
      abortReasonValue = reason;
    }
    interruptedBySignal = true;
    if (!abortController.signal.aborted) {
      abortController.abort(reason);
    }
    if (process.exitCode === undefined || process.exitCode === 0) {
      process.exitCode = 1;
    }
  };

  const runCleanupOnce = async (): Promise<void> => {
    if (cleanupLatch) return;
    cleanupLatch = true;
    if (cleanupFn !== null) {
      await cleanupFn();
    }
  };

  const onSignal = (signalName: string): void => {
    markAborted(signalName);
    void runCleanupOnce();
  };

  const registerSignalHandlers = (fn: CleanupFn): void => {
    cleanupFn = fn;
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      const listener = (): void => {
        onSignal(signal);
      };
      process.on(signal, listener);
      signalHandlers.push({ signal, listener });
    }
    onUncaughtException = (): void => {
      markAborted('uncaughtException');
      void runCleanupOnce();
    };
    onUnhandledRejection = (): void => {
      markAborted('unhandledRejection');
      void runCleanupOnce();
    };
    process.on('uncaughtException', onUncaughtException);
    process.on('unhandledRejection', onUnhandledRejection);
  };

  const restoreHandlers = (): void => {
    for (const { signal, listener } of signalHandlers) {
      process.removeListener(signal, listener);
    }
    signalHandlers.length = 0;
    if (onUncaughtException !== null) {
      process.removeListener('uncaughtException', onUncaughtException);
      onUncaughtException = null;
    }
    if (onUnhandledRejection !== null) {
      process.removeListener('unhandledRejection', onUnhandledRejection);
      onUnhandledRejection = null;
    }
  };

  return {
    registerSignalHandlers,
    runCleanupOnce,
    wasInterruptedBySignal: () => interruptedBySignal,
    isAborted: () => abortController.signal.aborted || interruptedBySignal,
    abortReason: () => abortReasonValue,
    getAbortSignal: () => abortController.signal,
    restoreHandlers,
    markInterruptedForTests: (reason = 'test-interrupt') => {
      markAborted(reason);
    },
    throwIfAborted: () => {
      if (abortController.signal.aborted || interruptedBySignal) {
        throw new GateAbortedError(abortReasonValue ?? 'aborted');
      }
    },
  };
};
