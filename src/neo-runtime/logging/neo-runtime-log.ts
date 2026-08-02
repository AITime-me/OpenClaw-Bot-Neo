import type { NeoRuntimeFailureClass } from '../neo-runtime-failures.js';
import type { NeoProcessOutputPort, NeoProcessSignal } from '../ports/neo-process-ports.js';
import { redactNeoRuntimeLogText } from './neo-runtime-log-redaction.js';

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

export const NEO_RUNTIME_LOG_LINE_MAX_BYTES = 512 as const;

const STDERR_EVENTS = new Set<NeoRuntimeLogEventName>([
  'neo.runtime.failed',
  'neo.runtime.shutdown_timeout',
  'neo.config.invalid',
]);

export const isNeoRuntimeStderrEvent = (event: NeoRuntimeLogEventName): boolean =>
  STDERR_EVENTS.has(event);

export const serializeNeoRuntimeLogEvent = (event: NeoRuntimeLogEvent): string => {
  const payload: {
    readonly event: NeoRuntimeLogEventName;
    readonly pid: number;
    readonly atUtc: string;
    readonly failureClass?: NeoRuntimeFailureClass;
    readonly signal?: NeoProcessSignal;
  } = {
    event: event.event,
    pid: event.pid,
    atUtc: event.atUtc,
    ...(event.failureClass === undefined ? {} : { failureClass: event.failureClass }),
    ...(event.signal === undefined ? {} : { signal: event.signal }),
  };
  let serialized = JSON.stringify(payload);
  serialized = redactNeoRuntimeLogText(serialized);
  if (serialized.length > NEO_RUNTIME_LOG_LINE_MAX_BYTES) {
    return serialized.slice(0, NEO_RUNTIME_LOG_LINE_MAX_BYTES);
  }
  return serialized;
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

export const createProductionNeoRuntimeLogSink = (
  pid: number,
  nowUtcIso: () => string,
  output: NeoProcessOutputPort,
): NeoRuntimeLogSink => {
  const memory = createNeoRuntimeLogSink(pid, nowUtcIso);
  return Object.freeze({
    get events() {
      return memory.events;
    },
    emit: (event: NeoRuntimeLogEvent): void => {
      memory.emit(event);
      try {
        const line = serializeNeoRuntimeLogEvent(event);
        if (isNeoRuntimeStderrEvent(event.event)) output.writeStderrLine(line);
        else output.writeStdoutLine(line);
      } catch {
        // Logger output failure must not crash Neo orchestration.
      }
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
