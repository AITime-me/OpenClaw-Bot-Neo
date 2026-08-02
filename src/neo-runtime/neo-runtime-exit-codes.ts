import type { NeoRuntimeFailureClass } from './neo-runtime-failures.js';

export const NEO_RUNTIME_EXIT_SUCCESS = 0 as const;
export const NEO_RUNTIME_EXIT_CONFIG_FAILURE = 2 as const;
export const NEO_RUNTIME_EXIT_UNSUPPORTED_RUNTIME = 3 as const;
export const NEO_RUNTIME_EXIT_PROCESS_LOCK_HELD = 10 as const;
export const NEO_RUNTIME_EXIT_STARTUP_FAILURE = 11 as const;
export const NEO_RUNTIME_EXIT_RUNTIME_FATAL = 12 as const;
/**
 * Neo shutdown-timeout exit code. Collides numerically with Node.js exit code 13
 * (unfinished top-level await). Gate evidence must require structured
 * `neo.runtime.shutdown_timeout` before classifying raw child exit 13 as internal shutdown timeout.
 */
export const NEO_RUNTIME_EXIT_SHUTDOWN_TIMEOUT = 13 as const;
export const NEO_RUNTIME_EXIT_SECURITY_INVARIANT = 14 as const;

export type NeoRuntimeExitCode =
  | typeof NEO_RUNTIME_EXIT_SUCCESS
  | typeof NEO_RUNTIME_EXIT_CONFIG_FAILURE
  | typeof NEO_RUNTIME_EXIT_UNSUPPORTED_RUNTIME
  | typeof NEO_RUNTIME_EXIT_PROCESS_LOCK_HELD
  | typeof NEO_RUNTIME_EXIT_STARTUP_FAILURE
  | typeof NEO_RUNTIME_EXIT_RUNTIME_FATAL
  | typeof NEO_RUNTIME_EXIT_SHUTDOWN_TIMEOUT
  | typeof NEO_RUNTIME_EXIT_SECURITY_INVARIANT;

/**
 * Pure mapping from failure class to process exit code. Does not call process.exit.
 */
export const mapNeoRuntimeFailureClassToExitCode = (
  failureClass: NeoRuntimeFailureClass | undefined,
): NeoRuntimeExitCode | typeof NEO_RUNTIME_EXIT_RUNTIME_FATAL => {
  switch (failureClass) {
    case 'CONFIGURATION':
      return NEO_RUNTIME_EXIT_CONFIG_FAILURE;
    case 'UNSUPPORTED_RUNTIME':
      return NEO_RUNTIME_EXIT_UNSUPPORTED_RUNTIME;
    case 'PROCESS_LOCK_HELD':
      return NEO_RUNTIME_EXIT_PROCESS_LOCK_HELD;
    case 'STARTUP':
    case 'START_IN_PROGRESS':
      return NEO_RUNTIME_EXIT_STARTUP_FAILURE;
    case 'SHUTDOWN_TIMEOUT':
      return NEO_RUNTIME_EXIT_SHUTDOWN_TIMEOUT;
    case 'SECURITY_INVARIANT':
      return NEO_RUNTIME_EXIT_SECURITY_INVARIANT;
    case 'TERMINAL_STATE':
    case 'RUNTIME_FATAL':
      return NEO_RUNTIME_EXIT_RUNTIME_FATAL;
    default:
      return NEO_RUNTIME_EXIT_RUNTIME_FATAL;
  }
};

export const mapNeoRuntimeCloseReasonToExitCode = (
  stoppedCleanly: boolean,
  failureClass?: NeoRuntimeFailureClass,
): NeoRuntimeExitCode => {
  if (stoppedCleanly) return NEO_RUNTIME_EXIT_SUCCESS;
  return mapNeoRuntimeFailureClassToExitCode(failureClass);
};
