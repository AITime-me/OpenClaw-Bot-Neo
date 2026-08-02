import type { NeoRuntimeFailureClass } from './neo-runtime-failures.js';
import type { NeoRuntimeHealth, NeoRuntimeLifecycleState } from './neo-runtime.types.js';

export const isTerminalLifecycle = (lifecycle: NeoRuntimeLifecycleState): boolean =>
  lifecycle === 'stopped' || lifecycle === 'failed';

export const canAcceptStart = (lifecycle: NeoRuntimeLifecycleState): boolean =>
  lifecycle === 'new' || lifecycle === 'starting' || lifecycle === 'running';

export const buildNeoRuntimeHealth = (input: {
  readonly lifecycle: NeoRuntimeLifecycleState;
  readonly durableHostOpened: boolean;
  readonly failureClass?: NeoRuntimeFailureClass;
}): NeoRuntimeHealth =>
  Object.freeze({
    lifecycle: input.lifecycle,
    durableHostOpened: input.durableHostOpened,
    runtimeReady: input.lifecycle === 'running',
    stopping: input.lifecycle === 'stopping',
    failed: input.lifecycle === 'failed',
    ...(input.failureClass === undefined ? {} : { failureClass: input.failureClass }),
  });
