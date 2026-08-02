import type { NeoRuntimeDiagnostics } from './neo-runtime-diagnostics.js';
import type {
  NeoRuntimeCloseFailure,
  NeoRuntimeCloseResult,
  NeoRuntimeFailureClass,
  NeoRuntimeStartFailure,
  NeoRuntimeStartResult,
} from './neo-runtime-failures.js';

export type NeoRuntimeLifecycleState =
  'new' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';

/**
 * Redacted runtime health snapshot. Safe for logs and future status surfaces.
 */
export interface NeoRuntimeHealth {
  readonly lifecycle: NeoRuntimeLifecycleState;
  readonly durableHostOpened: boolean;
  readonly runtimeReady: boolean;
  readonly stopping: boolean;
  readonly failed: boolean;
  readonly failureClass?: NeoRuntimeFailureClass;
}

export type NeoRuntimeCloseReason = 'operator-request' | 'startup-abort' | 'shutdown' | 'fatal';

export interface NeoRuntime {
  readonly diagnostics: NeoRuntimeDiagnostics;
  getHealth(): NeoRuntimeHealth;
  start(): Promise<NeoRuntimeStartResult>;
  close(reason: NeoRuntimeCloseReason): Promise<NeoRuntimeCloseResult>;
}

export type {
  NeoRuntimeCloseFailure,
  NeoRuntimeCloseResult,
  NeoRuntimeStartFailure,
  NeoRuntimeStartResult,
};
