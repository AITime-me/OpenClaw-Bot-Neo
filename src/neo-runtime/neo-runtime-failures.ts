import { err, ok, type Result } from '../core/domain/result.js';

export type NeoRuntimeFailureClass =
  | 'CONFIGURATION'
  | 'UNSUPPORTED_RUNTIME'
  | 'PROCESS_LOCK_HELD'
  | 'STARTUP'
  | 'RUNTIME_FATAL'
  | 'SHUTDOWN_TIMEOUT'
  | 'SECURITY_INVARIANT'
  | 'TERMINAL_STATE'
  | 'START_IN_PROGRESS';

export type NeoRuntimeFailureCode =
  | 'NEO_RUNTIME_CONFIGURATION_FAILED'
  | 'NEO_RUNTIME_UNSUPPORTED'
  | 'NEO_RUNTIME_LOCK_HELD'
  | 'NEO_RUNTIME_STARTUP_FAILED'
  | 'NEO_RUNTIME_FATAL'
  | 'NEO_RUNTIME_SHUTDOWN_TIMEOUT'
  | 'NEO_RUNTIME_SECURITY_INVARIANT'
  | 'NEO_RUNTIME_TERMINAL_STATE'
  | 'NEO_RUNTIME_START_IN_PROGRESS'
  | 'NEO_RUNTIME_CLOSE_BUSY'
  | 'NEO_RUNTIME_CLOSE_INCOMPLETE';

export interface NeoRuntimeFailure {
  readonly code: NeoRuntimeFailureCode;
  readonly failureClass: NeoRuntimeFailureClass;
  readonly reason: string;
}

export type NeoRuntimeStartResult = Result<void, NeoRuntimeFailure>;
export type NeoRuntimeCloseResult = Result<void, NeoRuntimeFailure>;

const freezeFailure = (failure: NeoRuntimeFailure): NeoRuntimeFailure =>
  Object.freeze({ ...failure });

export const failNeoRuntime = (
  code: NeoRuntimeFailureCode,
  failureClass: NeoRuntimeFailureClass,
  reason: string,
): NeoRuntimeStartResult => err(freezeFailure({ code, failureClass, reason }));

export const failNeoRuntimeClose = (
  code: NeoRuntimeFailureCode,
  failureClass: NeoRuntimeFailureClass,
  reason: string,
): NeoRuntimeCloseResult => err(freezeFailure({ code, failureClass, reason }));

export const okNeoRuntime = (): NeoRuntimeStartResult => ok(undefined);
export const okNeoRuntimeClose = (): NeoRuntimeCloseResult => ok(undefined);

export type NeoRuntimeCloseFailure = NeoRuntimeFailure;
export type NeoRuntimeStartFailure = NeoRuntimeFailure;

/**
 * Bounded redacted serialization for failure surfaces. Never carries paths, secrets, or stacks.
 */
export const serializeNeoRuntimeFailure = (failure: NeoRuntimeFailure): string => {
  const payload = {
    code: failure.code,
    failureClass: failure.failureClass,
    reason: failure.reason.slice(0, 240),
  };
  const serialized = JSON.stringify(payload);
  if (serialized.length > 512) return serialized.slice(0, 512);
  return serialized;
};
