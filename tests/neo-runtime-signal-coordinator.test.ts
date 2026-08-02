import { describe, expect, it, vi } from 'vitest';
import { createSignalCoordinator } from '../src/neo-runtime/coordination/signal-coordinator.js';
import { createNeoRuntimeLogSink } from '../src/neo-runtime/logging/neo-runtime-log.js';
import { createFakeNeoSignalPort, fixedIdentity } from './support/neo-runtime-fixtures.js';

describe('neo runtime signal coordinator', () => {
  const makeCoordinator = () => {
    const identity = fixedIdentity();
    const log = createNeoRuntimeLogSink(identity.pid, identity.nowUtcIso);
    const signals = createFakeNeoSignalPort();
    const graceful = vi.fn();
    const fatal = vi.fn();
    const coordinator = createSignalCoordinator({
      signals: signals.port,
      log,
      pid: identity.pid,
      nowUtcIso: identity.nowUtcIso,
    });
    coordinator.install({ onGracefulShutdown: graceful, onFatal: fatal });
    return { coordinator, signals, graceful, fatal, log };
  };

  it.each(['SIGTERM', 'SIGINT'] as const)('%s triggers one graceful close path', (signal) => {
    const { signals, graceful, fatal } = makeCoordinator();
    signals.emitSignal(signal);
    signals.emitSignal(signal);
    expect(graceful).toHaveBeenCalledTimes(1);
    expect(fatal).not.toHaveBeenCalled();
  });

  it('concurrent SIGTERM and SIGINT still close once', () => {
    const { signals, graceful } = makeCoordinator();
    signals.emitSignal('SIGTERM');
    signals.emitSignal('SIGINT');
    expect(graceful).toHaveBeenCalledTimes(1);
  });

  it('SIGHUP is ignored and does not close', () => {
    const { signals, graceful, log } = makeCoordinator();
    signals.emitSignal('SIGHUP');
    expect(graceful).not.toHaveBeenCalled();
    expect(log.events.some((event) => event.event === 'neo.signal.sighup_ignored')).toBe(true);
  });

  it('fatal handler triggers once for repeated fatal events', () => {
    const { signals, fatal, graceful } = makeCoordinator();
    signals.emitFatal('uncaughtException');
    signals.emitFatal('unhandledRejection');
    expect(fatal).toHaveBeenCalledTimes(1);
    expect(graceful).not.toHaveBeenCalled();
  });

  it('removes listeners on uninstall', () => {
    const { coordinator, signals } = makeCoordinator();
    coordinator.uninstall();
    expect(signals.hasHandlers()).toBe(false);
  });
});
