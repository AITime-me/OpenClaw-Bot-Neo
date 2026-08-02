import type { NeoRuntimeFailureClass } from '../neo-runtime-failures.js';
import type { NeoProcessSignal } from '../ports/neo-process-ports.js';

export type NeoRuntimeLogEventName =
  | 'neo.runtime.starting'
  | 'neo.runtime.ready'
  | 'neo.runtime.stopping'
  | 'neo.runtime.stopped'
  | 'neo.runtime.failed'
  | 'neo.signal.received'
  | 'neo.signal.sighup_ignored'
  | 'neo.runtime.shutdown_timeout'
  | 'neo.config.invalid';

export type NeoRuntimeLogEvent = {
  readonly event: NeoRuntimeLogEventName;
  readonly pid: number;
  readonly atUtc: string;
  readonly failureClass?: NeoRuntimeFailureClass;
  readonly signal?: NeoProcessSignal;
};

export type NeoRuntimeLogSink = {
  readonly events: readonly NeoRuntimeLogEvent[];
  readonly emit: (event: NeoRuntimeLogEvent) => void;
};

export const createNeoRuntimeLogSink = (
  pid: number,
  nowUtcIso: () => string,
): NeoRuntimeLogSink => {
  const events: NeoRuntimeLogEvent[] = [];
  return Object.freeze({
    get events() {
      return Object.freeze([...events]);
    },
    emit: (event: NeoRuntimeLogEvent): void => {
      events.push(
        Object.freeze({
          event: event.event,
          pid,
          atUtc: nowUtcIso(),
          ...(event.failureClass === undefined ? {} : { failureClass: event.failureClass }),
          ...(event.signal === undefined ? {} : { signal: event.signal }),
        }),
      );
    },
  });
};

export const emitRuntimeLog = (
  sink: NeoRuntimeLogSink,
  pid: number,
  nowUtcIso: () => string,
  event: NeoRuntimeLogEventName,
  extras: {
    readonly failureClass?: NeoRuntimeFailureClass;
    readonly signal?: NeoProcessSignal;
  } = {},
): void => {
  sink.emit(
    Object.freeze({
      event,
      pid,
      atUtc: nowUtcIso(),
      ...extras,
    }),
  );
};
