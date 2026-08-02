import type { NeoRuntimeExitCode } from '../neo-runtime-exit-codes.js';
import type { NeoRuntimeFailureClass } from '../neo-runtime-failures.js';
import { mapNeoRuntimeFailureClassToExitCode } from '../neo-runtime-exit-codes.js';

export type NeoExitDisposition = {
  readonly failureClass?: NeoRuntimeFailureClass;
  readonly exitCode: NeoRuntimeExitCode;
};

const PRECEDENCE: readonly NeoRuntimeFailureClass[] = [
  'RUNTIME_FATAL',
  'SHUTDOWN_TIMEOUT',
  'PROCESS_LOCK_HELD',
  'STARTUP',
  'START_IN_PROGRESS',
  'CONFIGURATION',
  'UNSUPPORTED_RUNTIME',
  'SECURITY_INVARIANT',
  'TERMINAL_STATE',
];

const precedenceRank = (failureClass: NeoRuntimeFailureClass | undefined): number => {
  if (failureClass === undefined) return Number.MAX_SAFE_INTEGER;
  const index = PRECEDENCE.indexOf(failureClass);
  return index === -1 ? PRECEDENCE.length : index;
};

export const createNeoExitDisposition = (): {
  readonly snapshot: () => NeoExitDisposition;
  readonly recordFailure: (failureClass: NeoRuntimeFailureClass) => void;
  readonly recordGracefulStop: () => void;
} => {
  let failureClass: NeoRuntimeFailureClass | undefined;
  let gracefulStop = false;

  const snapshot = (): NeoExitDisposition => {
    if (failureClass !== undefined) {
      return {
        failureClass,
        exitCode: mapNeoRuntimeFailureClassToExitCode(failureClass),
      };
    }
    if (gracefulStop) {
      return { exitCode: 0 };
    }
    return { exitCode: 0 };
  };

  const recordFailure = (next: NeoRuntimeFailureClass): void => {
    if (precedenceRank(next) < precedenceRank(failureClass)) {
      failureClass = next;
    }
  };

  const recordGracefulStop = (): void => {
    if (failureClass === undefined) gracefulStop = true;
  };

  return { snapshot, recordFailure, recordGracefulStop };
};
