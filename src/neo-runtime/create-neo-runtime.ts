import { NEO_RUNTIME_DIAGNOSTICS } from './neo-runtime-diagnostics.js';
import {
  failNeoRuntime,
  failNeoRuntimeClose,
  okNeoRuntime,
  okNeoRuntimeClose,
  type NeoRuntimeFailureClass,
} from './neo-runtime-failures.js';
import { buildNeoRuntimeHealth } from './neo-runtime-lifecycle.js';
import type {
  NeoRuntime,
  NeoRuntimeCloseReason,
  NeoRuntimeCloseResult,
  NeoRuntimeHealth,
  NeoRuntimeLifecycleState,
  NeoRuntimeStartResult,
} from './neo-runtime.types.js';

/**
 * Narrow durable owner surface for Neo runtime shutdown. Must not expose host/SQLite/lock/root.
 */
export type NeoRuntimeDurableOwner = {
  readonly close: () => NeoRuntimeOwnerCloseResult;
};

export type NeoRuntimeOwnerCloseResult = {
  readonly ok: boolean;
  readonly error?: {
    readonly code: string;
    readonly reason: string;
    readonly stage?: string;
  };
};

export type NeoRuntimeDurableOpenResult =
  | { readonly ok: true; readonly value: NeoRuntimeDurableOwner }
  | { readonly ok: false; readonly error: { readonly code: string; readonly reason: string } };

export type NeoRuntimeDurableOpener = () => Promise<NeoRuntimeDurableOpenResult>;

export interface CreateNeoRuntimeInput {
  readonly openDurableHost: NeoRuntimeDurableOpener;
}

const ownerCloseSucceeded = (result: NeoRuntimeOwnerCloseResult): boolean => result.ok;

const mapCompositionCodeToFailureClass = (code: string): NeoRuntimeFailureClass => {
  if (code === 'DURABLE_COMPOSITION_LOCK_HELD') return 'PROCESS_LOCK_HELD';
  if (code === 'DURABLE_COMPOSITION_UNAVAILABLE') return 'CONFIGURATION';
  if (code === 'DURABLE_COMPOSITION_OWNERSHIP_CLEANUP_REQUIRED') return 'STARTUP';
  if (code === 'DURABLE_STORAGE_BOOTSTRAP_FAILED' || code === 'DURABLE_COMPOSITION_ASSEMBLY_FAILED')
    return 'STARTUP';
  return 'STARTUP';
};

/**
 * App-private Neo runtime lifecycle controller. Does not read env/files or call process.exit.
 */
export const createNeoRuntime = (input: CreateNeoRuntimeInput): NeoRuntime => {
  let lifecycle: NeoRuntimeLifecycleState = 'new';
  let durableHostOpened = false;
  let failureClass: NeoRuntimeFailureClass | undefined;
  let owner: NeoRuntimeDurableOwner | undefined;
  let shutdownLatch = false;
  let startInFlight: Promise<NeoRuntimeStartResult> | undefined;
  let closeInFlight: Promise<NeoRuntimeCloseResult> | undefined;

  const readLifecycle = (): NeoRuntimeLifecycleState => lifecycle;

  const snapshotHealth = (): NeoRuntimeHealth =>
    buildNeoRuntimeHealth({
      lifecycle,
      durableHostOpened,
      ...(failureClass === undefined ? {} : { failureClass }),
    });

  const markFailed = (nextFailureClass: NeoRuntimeFailureClass): void => {
    lifecycle = 'failed';
    failureClass = nextFailureClass;
    durableHostOpened = false;
    owner = undefined;
  };

  const closeOwnerIfPresent = (): NeoRuntimeCloseResult => {
    if (owner === undefined) {
      durableHostOpened = false;
      return okNeoRuntimeClose();
    }
    const closeResult = owner.close();
    if (ownerCloseSucceeded(closeResult)) {
      owner = undefined;
      durableHostOpened = false;
      return okNeoRuntimeClose();
    }
    durableHostOpened = true;
    return failNeoRuntimeClose(
      'NEO_RUNTIME_CLOSE_INCOMPLETE',
      'START_IN_PROGRESS',
      'Durable host close is incomplete and may be retried.',
    );
  };

  const runClose = async (reason: NeoRuntimeCloseReason): Promise<NeoRuntimeCloseResult> => {
    if (lifecycle === 'stopped') return okNeoRuntimeClose();
    if (lifecycle === 'failed') return okNeoRuntimeClose();

    if (lifecycle === 'new') {
      lifecycle = 'stopped';
      durableHostOpened = false;
      owner = undefined;
      return okNeoRuntimeClose();
    }

    if (lifecycle === 'starting') {
      shutdownLatch = true;
      if (startInFlight !== undefined) await startInFlight;
    }

    const lifecycleAfterStart = readLifecycle();
    if (lifecycleAfterStart === 'stopped' || lifecycleAfterStart === 'failed') {
      return okNeoRuntimeClose();
    }

    if (lifecycleAfterStart === 'running') {
      lifecycle = 'stopping';
    } else if (lifecycleAfterStart === 'starting') {
      lifecycle = 'stopped';
      durableHostOpened = false;
      owner = undefined;
      return okNeoRuntimeClose();
    }

    if (lifecycle !== 'stopping') {
      return failNeoRuntimeClose(
        'NEO_RUNTIME_CLOSE_BUSY',
        'TERMINAL_STATE',
        'Neo runtime close is not available in the current lifecycle state.',
      );
    }

    const ownerClose = closeOwnerIfPresent();
    if (!ownerClose.ok) {
      lifecycle = 'stopping';
      if (reason === 'fatal') {
        markFailed('RUNTIME_FATAL');
      }
      return ownerClose;
    }

    lifecycle = 'stopped';
    return okNeoRuntimeClose();
  };

  const startInternal = async (): Promise<NeoRuntimeStartResult> => {
    if (lifecycle === 'running') return okNeoRuntime();
    if (lifecycle === 'stopped' || lifecycle === 'failed') {
      return failNeoRuntime(
        'NEO_RUNTIME_TERMINAL_STATE',
        'TERMINAL_STATE',
        'Neo runtime cannot start after a terminal lifecycle state.',
      );
    }
    if (lifecycle === 'stopping') {
      return failNeoRuntime(
        'NEO_RUNTIME_START_IN_PROGRESS',
        'START_IN_PROGRESS',
        'Neo runtime cannot start while shutdown is in progress.',
      );
    }

    lifecycle = 'starting';

    const openResult = await input.openDurableHost();

    if (!openResult.ok) {
      const mappedClass = mapCompositionCodeToFailureClass(openResult.error.code);
      markFailed(mappedClass);
      return failNeoRuntime(
        mappedClass === 'PROCESS_LOCK_HELD'
          ? 'NEO_RUNTIME_LOCK_HELD'
          : 'NEO_RUNTIME_STARTUP_FAILED',
        mappedClass,
        'Neo runtime durable host startup failed.',
      );
    }

    if (shutdownLatch) {
      owner = openResult.value;
      durableHostOpened = true;
      const closeResult = closeOwnerIfPresent();
      lifecycle = closeResult.ok ? 'stopped' : 'stopping';
      if (!closeResult.ok) {
        return failNeoRuntime(
          'NEO_RUNTIME_STARTUP_FAILED',
          'STARTUP',
          'Neo runtime aborted startup close is incomplete.',
        );
      }
      return failNeoRuntime(
        'NEO_RUNTIME_STARTUP_FAILED',
        'STARTUP',
        'Neo runtime startup was aborted before becoming ready.',
      );
    }

    owner = openResult.value;
    durableHostOpened = true;
    lifecycle = 'running';
    return okNeoRuntime();
  };

  const start = (): Promise<NeoRuntimeStartResult> => {
    if (lifecycle === 'running') return Promise.resolve(okNeoRuntime());
    if (lifecycle === 'stopped' || lifecycle === 'failed') {
      return Promise.resolve(
        failNeoRuntime(
          'NEO_RUNTIME_TERMINAL_STATE',
          'TERMINAL_STATE',
          'Neo runtime cannot start after a terminal lifecycle state.',
        ),
      );
    }
    if (startInFlight !== undefined) return startInFlight;
    startInFlight = startInternal().finally(() => {
      startInFlight = undefined;
    });
    return startInFlight;
  };

  const close = (reason: NeoRuntimeCloseReason): Promise<NeoRuntimeCloseResult> => {
    if (closeInFlight !== undefined) return closeInFlight;
    closeInFlight = runClose(reason).finally(() => {
      closeInFlight = undefined;
    });
    return closeInFlight;
  };

  return Object.freeze({
    diagnostics: NEO_RUNTIME_DIAGNOSTICS,
    getHealth: snapshotHealth,
    start,
    close,
  });
};
