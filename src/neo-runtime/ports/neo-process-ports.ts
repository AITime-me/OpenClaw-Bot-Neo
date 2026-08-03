export type NeoProcessSignal = 'SIGTERM' | 'SIGINT' | 'SIGHUP';

export type NeoProcessSignalHandler = (signal: NeoProcessSignal) => void;

export type NeoProcessFatalHandler = (kind: 'uncaughtException' | 'unhandledRejection') => void;

export type NeoProcessSignalPort = {
  readonly registerSignalHandlers: (
    onSignal: NeoProcessSignalHandler,
    onFatal: NeoProcessFatalHandler,
  ) => void;
  readonly removeSignalHandlers: () => void;
};

export type NeoProcessIdentityPort = {
  readonly pid: number;
  readonly nowUtcIso: () => string;
};

export type NeoProcessSleepPort = {
  readonly sleep: (milliseconds: number) => Promise<void>;
};

export type NeoProcessConfigFileReadResult =
  { readonly ok: true; readonly json: unknown } | { readonly ok: false; readonly reason: string };

export type NeoProcessConfigFileReaderPort = {
  readonly readJsonFile: (absolutePath: string) => Promise<NeoProcessConfigFileReadResult>;
};

export type NeoRuntimeReadinessSnapshot = {
  readonly schemaVersion: '2';
  readonly pid: number;
  readonly lifecycle: 'running';
  readonly runtimeReady: true;
  readonly durableHostOpened: true;
  readonly startedAtUtc: string;
  readonly bootId: string;
  readonly startTimeTicks: string;
};

export type NeoProcessReadinessPort = {
  readonly removeStale: (executionRoot: string) => Promise<void>;
  readonly publish: (
    executionRoot: string,
    snapshot: NeoRuntimeReadinessSnapshot,
  ) => Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }>;
  readonly remove: (executionRoot: string) => Promise<void>;
};

/** Idempotent release for a single process-lifetime keep-alive lease. */
export type NeoProcessKeepAliveLease = {
  readonly release: () => void;
};

/**
 * Keeps the Node event loop ref'd while Neo coordinates startup, readiness, and shutdown.
 * Production uses a ref'd timer; tests inject a fake port.
 */
export type NeoProcessKeepAlivePort = {
  readonly acquire: () => NeoProcessKeepAliveLease;
};

/** Narrow production log output — one bounded JSON line per call. */
export type NeoProcessOutputPort = {
  readonly writeStdoutLine: (line: string) => void;
  readonly writeStderrLine: (line: string) => void;
};
