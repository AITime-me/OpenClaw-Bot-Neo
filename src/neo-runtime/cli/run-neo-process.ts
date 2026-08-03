import process from 'node:process';
import type { NeoRuntime } from '../neo-runtime.types.js';
import type { NeoRuntimeExitCode } from '../neo-runtime-exit-codes.js';
import { NEO_RUNTIME_EXIT_SUCCESS } from '../neo-runtime-exit-codes.js';
import { createNeoExitDisposition } from '../coordination/exit-disposition.js';
import { createNoOpNeoProcessKeepAlivePort } from '../coordination/neo-process-keep-alive.js';
import { createProcessLifetimeBarrier } from '../coordination/process-lifetime-coordinator.js';
import { closeRuntimeWithRetry } from '../coordination/shutdown-close-retry.js';
import { createSignalCoordinator } from '../coordination/signal-coordinator.js';
import { parseNeoCliArguments } from './parse-neo-cli-arguments.js';
import { emitRuntimeLog } from '../logging/neo-runtime-log.js';
import { bootstrapProductionConfig } from '../production/production-config-bootstrap.js';
import {
  createProductionNeoRuntime,
  type ProductionNeoRuntimeConfig,
} from '../production/create-production-neo-runtime.js';
import type {
  NeoProcessConfigFileReaderPort,
  NeoProcessIdentityPort,
  NeoProcessKeepAlivePort,
  NeoProcessReadinessPort,
  NeoProcessSignalPort,
  NeoProcessSleepPort,
} from '../ports/neo-process-ports.js';
import type { ProcessInstanceIdentityProvider } from '../process-identity/process-instance-identity-provider.port.js';
import type { NeoRuntimeLogSink } from '../logging/neo-runtime-log.js';
import { NEO_READINESS_SCHEMA_VERSION } from '../readiness/neo-runtime-readiness-file.js';
import {
  createNodeProcessSignalPort,
  readNeoProcessArgv,
} from '../adapters/create-node-process-signal-port.js';
import { createNodeProcessKeepAlivePort } from '../adapters/create-node-process-keep-alive-port.js';
import { createNodeProcessOutputPort } from '../adapters/create-node-process-output-port.js';
import { createNodeProductionConfigFileReader } from '../production/read-production-config-file.js';
import { createNodeNeoRuntimeReadinessPort } from '../readiness/neo-runtime-readiness-file.js';
import { createNodeProcessInstanceProvider } from '../process-identity/create-node-process-instance-provider.js';
import { createProductionNeoRuntimeLogSink } from '../logging/neo-runtime-log.js';
import { applyRestrictiveProcessUmask } from './apply-restrictive-process-umask.js';

export type RunNeoProcessResult = {
  readonly exitCode: NeoRuntimeExitCode;
};

export type RunNeoProcessDeps = {
  readonly argv: readonly string[];
  readonly signals: NeoProcessSignalPort;
  readonly identity: NeoProcessIdentityPort;
  readonly sleep: NeoProcessSleepPort;
  readonly configReader: NeoProcessConfigFileReaderPort;
  readonly readiness: NeoProcessReadinessPort;
  readonly processInstance: ProcessInstanceIdentityProvider;
  readonly log: NeoRuntimeLogSink;
  readonly keepAlive?: NeoProcessKeepAlivePort;
  readonly createRuntime?: (config: ProductionNeoRuntimeConfig) => NeoRuntime;
};

const defaultClock = (identity: NeoProcessIdentityPort) => ({
  now: () => new Date(identity.nowUtcIso()),
});

export const runNeoProcess = async (deps: RunNeoProcessDeps): Promise<RunNeoProcessResult> => {
  const exit = createNeoExitDisposition();
  const parsed = parseNeoCliArguments(deps.argv);
  if (!parsed.ok) {
    exit.recordFailure('CONFIGURATION');
    emitRuntimeLog(deps.log, deps.identity.pid, deps.identity.nowUtcIso, 'neo.config.invalid', {
      failureClass: 'CONFIGURATION',
    });
    return { exitCode: exit.snapshot().exitCode };
  }
  if (parsed.value.kind === 'help') {
    return { exitCode: NEO_RUNTIME_EXIT_SUCCESS };
  }

  const cli = parsed.value;
  const bootstrap = await bootstrapProductionConfig(deps.configReader, {
    configPath: cli.configPath,
    storageBindingPath: cli.storageBindingPath,
    storagePolicyPath: cli.storagePolicyPath,
    clock: defaultClock(deps.identity),
  });
  if (!bootstrap.ok) {
    exit.recordFailure('CONFIGURATION');
    emitRuntimeLog(deps.log, deps.identity.pid, deps.identity.nowUtcIso, 'neo.config.invalid', {
      failureClass: 'CONFIGURATION',
    });
    return { exitCode: exit.snapshot().exitCode };
  }

  const keepAlive = deps.keepAlive ?? createNoOpNeoProcessKeepAlivePort();
  let keepAliveLease;
  try {
    keepAliveLease = keepAlive.acquire();
  } catch {
    exit.recordFailure('RUNTIME_FATAL');
    emitRuntimeLog(deps.log, deps.identity.pid, deps.identity.nowUtcIso, 'neo.runtime.failed', {
      failureClass: 'RUNTIME_FATAL',
    });
    return { exitCode: exit.snapshot().exitCode };
  }

  try {
    const runtime = (deps.createRuntime ?? createProductionNeoRuntime)({
      compositionInput: bootstrap.compositionInput,
    });
    const lifetime = createProcessLifetimeBarrier();
    let fatalLatched = false;
    let shutdownCloseInFlight: Promise<void> | undefined;

    const performShutdown = async (): Promise<void> => {
      emitRuntimeLog(deps.log, deps.identity.pid, deps.identity.nowUtcIso, 'neo.runtime.stopping');
      await deps.readiness.remove(cli.executionRoot);
      const closeResult = await closeRuntimeWithRetry({
        close: () => runtime.close(fatalLatched ? 'fatal' : 'shutdown'),
        sleep: deps.sleep.sleep,
      });
      if (!closeResult.ok) {
        exit.recordFailure('SHUTDOWN_TIMEOUT');
        emitRuntimeLog(
          deps.log,
          deps.identity.pid,
          deps.identity.nowUtcIso,
          'neo.runtime.shutdown_timeout',
          { failureClass: 'SHUTDOWN_TIMEOUT' },
        );
      } else {
        emitRuntimeLog(deps.log, deps.identity.pid, deps.identity.nowUtcIso, 'neo.runtime.stopped');
      }
    };

    const requestShutdown = (fatal: boolean): void => {
      if (fatal) {
        if (!fatalLatched) {
          fatalLatched = true;
          exit.recordFailure('RUNTIME_FATAL');
          emitRuntimeLog(
            deps.log,
            deps.identity.pid,
            deps.identity.nowUtcIso,
            'neo.runtime.failed',
            {
              failureClass: 'RUNTIME_FATAL',
            },
          );
        }
      } else {
        exit.recordGracefulStop();
      }
      lifetime.requestShutdown();
      shutdownCloseInFlight ??= performShutdown();
    };

    const signals = createSignalCoordinator({
      signals: deps.signals,
      log: deps.log,
      pid: deps.identity.pid,
      nowUtcIso: deps.identity.nowUtcIso,
    });

    signals.install({
      onGracefulShutdown: () => {
        requestShutdown(false);
      },
      onFatal: () => {
        requestShutdown(true);
      },
    });

    await deps.readiness.removeStale(cli.executionRoot);
    emitRuntimeLog(deps.log, deps.identity.pid, deps.identity.nowUtcIso, 'neo.runtime.starting');

    const startResult = await runtime.start();
    if (!startResult.ok) {
      if (!lifetime.isRequested()) {
        exit.recordFailure(startResult.error.failureClass);
        emitRuntimeLog(deps.log, deps.identity.pid, deps.identity.nowUtcIso, 'neo.runtime.failed', {
          failureClass: startResult.error.failureClass,
        });
      }
      await deps.readiness.remove(cli.executionRoot);
      await shutdownCloseInFlight;
      signals.uninstall();
      return { exitCode: exit.snapshot().exitCode };
    }

    if (signals.isShutdownRequested() || lifetime.isRequested()) {
      await shutdownCloseInFlight;
      signals.uninstall();
      return { exitCode: exit.snapshot().exitCode };
    }

    const health = runtime.getHealth();
    if (!health.runtimeReady) {
      exit.recordFailure('STARTUP');
      await deps.readiness.remove(cli.executionRoot);
      signals.uninstall();
      return { exitCode: exit.snapshot().exitCode };
    }

    const capturedIdentity = await deps.processInstance.captureSelf();
    if (!capturedIdentity.ok || capturedIdentity.value.pid !== deps.identity.pid) {
      exit.recordFailure('STARTUP');
      await deps.readiness.remove(cli.executionRoot);
      await runtime.close('shutdown');
      signals.uninstall();
      return { exitCode: exit.snapshot().exitCode };
    }

    const publish = await deps.readiness.publish(cli.executionRoot, {
      schemaVersion: NEO_READINESS_SCHEMA_VERSION,
      pid: deps.identity.pid,
      lifecycle: 'running',
      runtimeReady: true,
      durableHostOpened: true,
      startedAtUtc: deps.identity.nowUtcIso(),
      bootId: capturedIdentity.value.bootId,
      startTimeTicks: capturedIdentity.value.startTimeTicks,
    });
    if (!publish.ok) {
      exit.recordFailure('STARTUP');
      await runtime.close('shutdown');
      signals.uninstall();
      return { exitCode: exit.snapshot().exitCode };
    }

    if (lifetime.isRequested()) {
      await deps.readiness.remove(cli.executionRoot);
      await lifetime.wait();
      await shutdownCloseInFlight;
      signals.uninstall();
      return { exitCode: exit.snapshot().exitCode };
    }

    emitRuntimeLog(deps.log, deps.identity.pid, deps.identity.nowUtcIso, 'neo.runtime.ready');
    await lifetime.wait();
    await shutdownCloseInFlight;
    signals.uninstall();
    return { exitCode: exit.snapshot().exitCode };
  } finally {
    keepAliveLease.release();
  }
};

export const runNeoProcessFromNode = async (): Promise<RunNeoProcessResult> => {
  applyRestrictiveProcessUmask();
  const identity = {
    pid: process.pid,
    nowUtcIso: () => new Date().toISOString(),
  };
  const output = createNodeProcessOutputPort();
  const log = createProductionNeoRuntimeLogSink(identity.pid, identity.nowUtcIso, output);
  return runNeoProcess({
    argv: readNeoProcessArgv(),
    signals: createNodeProcessSignalPort(),
    identity,
    sleep: { sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
    configReader: createNodeProductionConfigFileReader(),
    readiness: createNodeNeoRuntimeReadinessPort(),
    processInstance: createNodeProcessInstanceProvider(),
    keepAlive: createNodeProcessKeepAlivePort(),
    log,
  });
};
