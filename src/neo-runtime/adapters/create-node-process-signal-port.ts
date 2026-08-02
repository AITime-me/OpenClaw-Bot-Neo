import process from 'node:process';
import type {
  NeoProcessFatalHandler,
  NeoProcessSignalHandler,
  NeoProcessSignalPort,
} from '../ports/neo-process-ports.js';

export const createNodeProcessSignalPort = (): NeoProcessSignalPort => {
  const signalListeners = new Map<NodeJS.Signals, () => void>();
  let onSignal: NeoProcessSignalHandler | undefined;
  let onFatal: NeoProcessFatalHandler | undefined;

  return {
    registerSignalHandlers: (signalHandler, fatalHandler) => {
      onSignal = signalHandler;
      onFatal = fatalHandler;
      for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
        const listener = (): void => {
          onSignal?.(signal);
        };
        signalListeners.set(signal, listener);
        process.on(signal, listener);
      }
      const uncaught = (): void => {
        onFatal?.('uncaughtException');
      };
      const rejection = (): void => {
        onFatal?.('unhandledRejection');
      };
      signalListeners.set('uncaughtException' as NodeJS.Signals, uncaught);
      signalListeners.set('unhandledRejection' as NodeJS.Signals, rejection);
      process.on('uncaughtException', uncaught);
      process.on('unhandledRejection', rejection);
    },
    removeSignalHandlers: () => {
      for (const [signal, listener] of signalListeners.entries()) {
        if (signal === ('uncaughtException' as NodeJS.Signals)) {
          process.removeListener('uncaughtException', listener);
          continue;
        }
        if (signal === ('unhandledRejection' as NodeJS.Signals)) {
          process.removeListener('unhandledRejection', listener);
          continue;
        }
        process.removeListener(signal, listener);
      }
      signalListeners.clear();
      onSignal = undefined;
      onFatal = undefined;
    },
  };
};

export const readNeoProcessArgv = (): readonly string[] =>
  Object.freeze([...process.argv.slice(2)]);
