import type { NeoProcessSignal, NeoProcessSignalPort } from '../ports/neo-process-ports.js';
import { emitRuntimeLog, type NeoRuntimeLogSink } from '../logging/neo-runtime-log.js';

export type SignalCoordinator = {
  readonly latchShutdown: () => void;
  readonly isShutdownRequested: () => boolean;
  readonly install: (handlers: {
    readonly onGracefulShutdown: () => void;
    readonly onFatal: () => void;
  }) => void;
  readonly uninstall: () => void;
};

export const createSignalCoordinator = (input: {
  readonly signals: NeoProcessSignalPort;
  readonly log: NeoRuntimeLogSink;
  readonly pid: number;
  readonly nowUtcIso: () => string;
}): SignalCoordinator => {
  let shutdownRequested = false;
  let gracefulHandler: (() => void) | undefined;
  let fatalHandler: (() => void) | undefined;
  let installed = false;

  const latchShutdown = (): void => {
    shutdownRequested = true;
  };

  const isShutdownRequested = (): boolean => shutdownRequested;

  const install = (handlers: {
    readonly onGracefulShutdown: () => void;
    readonly onFatal: () => void;
  }): void => {
    if (installed) return;
    installed = true;
    gracefulHandler = handlers.onGracefulShutdown;
    fatalHandler = handlers.onFatal;
    input.signals.registerSignalHandlers(
      (signal: NeoProcessSignal) => {
        if (signal === 'SIGHUP') {
          emitRuntimeLog(input.log, input.pid, input.nowUtcIso, 'neo.signal.sighup_ignored');
          return;
        }
        emitRuntimeLog(input.log, input.pid, input.nowUtcIso, 'neo.signal.received', { signal });
        if (shutdownRequested) return;
        latchShutdown();
        gracefulHandler?.();
      },
      () => {
        if (shutdownRequested) return;
        latchShutdown();
        fatalHandler?.();
      },
    );
  };

  const uninstall = (): void => {
    if (!installed) return;
    installed = false;
    gracefulHandler = undefined;
    fatalHandler = undefined;
    input.signals.removeSignalHandlers();
  };

  return { latchShutdown, isShutdownRequested, install, uninstall };
};
