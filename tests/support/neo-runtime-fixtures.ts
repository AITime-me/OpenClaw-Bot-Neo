import type { NeoRuntime } from '../../src/neo-runtime/neo-runtime.types.js';
import type {
  NeoProcessFatalHandler,
  NeoProcessSignal,
  NeoProcessSignalHandler,
  NeoProcessSignalPort,
} from '../../src/neo-runtime/ports/neo-process-ports.js';
import { NEO_RUNTIME_DIAGNOSTICS } from '../../src/neo-runtime/neo-runtime-diagnostics.js';
import {
  okNeoRuntime,
  okNeoRuntimeClose,
  type NeoRuntimeCloseResult,
} from '../../src/neo-runtime/neo-runtime-failures.js';
import { createInMemoryProductionConfigFileReader } from '../../src/neo-runtime/production/read-production-config-file.js';
import { createInMemoryNeoRuntimeReadinessPort } from '../../src/neo-runtime/readiness/neo-runtime-readiness-file.js';
import { createNeoRuntimeLogSink } from '../../src/neo-runtime/logging/neo-runtime-log.js';
import type { RunNeoProcessDeps } from '../../src/neo-runtime/cli/run-neo-process.js';

const isWindows = process.platform === 'win32';

export const NEO_TEST_PATHS = Object.freeze({
  config: isWindows ? 'C:\\neo-test\\config\\host.json' : '/neo-test/config/host.json',
  storageBinding: isWindows
    ? 'C:\\neo-test\\config\\binding.json'
    : '/neo-test/config/binding.json',
  storagePolicy: isWindows ? 'C:\\neo-test\\config\\policy.json' : '/neo-test/config/policy.json',
  executionRoot: isWindows ? 'C:\\neo-test\\exec' : '/neo-test/exec',
});

export const validLocalHostConfig = () =>
  Object.freeze({
    modelRouting: Object.freeze({
      status: 'draft',
      schemaVersion: '1.0',
      modelIdentifiersConfirmed: false,
      defaultProviderMode: 'subscription-oauth-only',
      apiFallbackEnabled: false,
      paidFallbackEnabled: false,
      routes: Object.freeze([
        Object.freeze({
          risk: 'low',
          capabilityTier: 'validated-general-tier',
          toolProfile: 'read-only-low-risk',
          approval: 'policy-dependent',
          onUnavailable: 'fail-closed',
        }),
        Object.freeze({
          risk: 'medium',
          capabilityTier: 'validated-general-tier',
          toolProfile: 'read-only-restricted-tools',
          approval: 'required-for-external-or-write',
          onUnavailable: 'fail-closed',
        }),
        Object.freeze({
          risk: 'high',
          capabilityTier: 'validated-high-assurance-tier',
          toolProfile: 'high-risk-no-elevated-tools',
          approval: 'owner-required',
          fallbackToWeakerTier: false,
          onUnavailable: 'fail-closed',
        }),
        Object.freeze({
          risk: 'untrusted-input',
          capabilityTier: 'validated-untrusted-content-tier',
          toolProfile: 'untrusted-no-exec-no-network-no-elevated-tools',
          approval: 'owner-required-for-any-tool-expansion',
          onUnavailable: 'fail-closed',
        }),
      ]),
      onUnavailable: 'fail-closed',
    }),
    memoryNamespaces: Object.freeze({
      status: 'draft',
      schemaVersion: '1.0',
      defaultAccess: 'deny',
      namespaces: Object.freeze([
        'tvoe-vremya',
        'ai-my-time',
        'personal',
        'shared-public',
        'security-restricted',
      ]),
      activeNamespaceRequired: true,
      crossNamespaceAccess: false,
      crossProjectAccessRequiresOwnerApproval: true,
      securityRestrictedIsolated: true,
      personalIsolatedFromProjects: true,
      requiredMetadata: Object.freeze([
        'source',
        'observedAt',
        'confidence',
        'classification',
        'retentionClass',
      ]),
      embedding: Object.freeze({ mode: 'none', externalProviderEnabled: false }),
    }),
    memoryClassification: Object.freeze({
      status: 'draft',
      schemaVersion: '1.0',
      defaultClassification: 'security-restricted',
      classes: Object.freeze({
        public: Object.freeze({ externalProcessingAllowed: 'policy-dependent' }),
        internal: Object.freeze({ externalProcessingAllowed: false }),
        confidential: Object.freeze({ externalProcessingAllowed: false }),
        'commercial-secret': Object.freeze({
          storeAllowed: false,
          externalProcessingAllowed: false,
        }),
        'security-restricted': Object.freeze({
          storeAllowed: false,
          externalProcessingAllowed: false,
        }),
      }),
      sensitiveDataScan: Object.freeze({ required: true, failureEffect: 'deny' }),
    }),
    securityPolicy: Object.freeze({
      status: 'draft',
      schemaVersion: '1.0',
      defaultEffect: 'deny',
      readOnlyFirst: true,
      paymentActionsAllowed: false,
      externalWritesAllowed: false,
      ownerApproval: Object.freeze({
        required: true,
        bindToTargetAndPayload: true,
        expires: true,
        replayAllowed: false,
      }),
      sensitiveDataScanner: Object.freeze({
        requiredBeforeAllSinks: true,
        deterministic: true,
        failureEffect: 'deny',
      }),
      reverseTrustAllowed: false,
    }),
  });

export const validStorageBinding = () =>
  Object.freeze({
    platform: 'posix' as const,
    storageRoot: '/var/lib/openclaw-neo',
  });

export const NEO_REPOSITORY_ROOT = '/neo-test/repo';

export const validStoragePolicy = () =>
  Object.freeze({
    expectedUid: 1000,
    allowedModeBits: 0o700,
    repositoryRoot: NEO_REPOSITORY_ROOT,
  });

export const validRunArgv = (): string[] => [
  '--config',
  NEO_TEST_PATHS.config,
  '--storage-binding',
  NEO_TEST_PATHS.storageBinding,
  '--storage-policy',
  NEO_TEST_PATHS.storagePolicy,
  '--execution-root',
  NEO_TEST_PATHS.executionRoot,
];

export const validConfigFiles = () =>
  Object.freeze({
    [NEO_TEST_PATHS.config]: validLocalHostConfig(),
    [NEO_TEST_PATHS.storageBinding]: validStorageBinding(),
    [NEO_TEST_PATHS.storagePolicy]: validStoragePolicy(),
  });

export const createFakeNeoSignalPort = () => {
  let signalHandler: NeoProcessSignalHandler | undefined;
  let fatalHandler: NeoProcessFatalHandler | undefined;
  let removed = false;

  const port: NeoProcessSignalPort = {
    registerSignalHandlers: (onSignal, onFatal) => {
      signalHandler = onSignal;
      fatalHandler = onFatal;
      removed = false;
    },
    removeSignalHandlers: () => {
      signalHandler = undefined;
      fatalHandler = undefined;
      removed = true;
    },
  };

  return {
    port,
    emitSignal: (signal: NeoProcessSignal) => signalHandler?.(signal),
    emitFatal: (kind: 'uncaughtException' | 'unhandledRejection') => fatalHandler?.(kind),
    wasRemoved: () => removed,
    hasHandlers: () => signalHandler !== undefined || fatalHandler !== undefined,
  };
};

export const fixedIdentity = () =>
  Object.freeze({
    pid: 4242,
    nowUtcIso: () => '2026-08-02T12:00:00.000Z',
  });

export const createSuccessfulMockRuntime = (
  input: {
    readonly startGate?: ReturnType<typeof deferred>;
    readonly closeBehavior?: () => NeoRuntimeCloseResult;
  } = {},
) => {
  let closeCalls = 0;
  const closeBehavior = input.closeBehavior ?? (() => okNeoRuntimeClose());

  const runtime: NeoRuntime = {
    diagnostics: NEO_RUNTIME_DIAGNOSTICS,
    getHealth: () =>
      Object.freeze({
        lifecycle: 'running',
        runtimeReady: true,
        durableHostOpened: true,
        stopping: false,
        failed: false,
      }),
    start: async () => {
      if (input.startGate) await input.startGate.promise;
      return okNeoRuntime();
    },
    close: () => {
      closeCalls += 1;
      return Promise.resolve(closeBehavior());
    },
  };

  return { runtime, getCloseCalls: () => closeCalls };
};

export const createRunNeoProcessDeps = (
  overrides: Partial<RunNeoProcessDeps> & {
    readonly configFiles?: Readonly<Record<string, unknown>>;
  } = {},
): {
  readonly deps: RunNeoProcessDeps;
  readonly signals: ReturnType<typeof createFakeNeoSignalPort>;
  readonly readiness: ReturnType<typeof createInMemoryNeoRuntimeReadinessPort>;
  readonly log: ReturnType<typeof createNeoRuntimeLogSink>;
} => {
  const identity = fixedIdentity();
  const log = createNeoRuntimeLogSink(identity.pid, identity.nowUtcIso);
  const signals = createFakeNeoSignalPort();
  const readiness = createInMemoryNeoRuntimeReadinessPort();
  const configFiles = overrides.configFiles ?? validConfigFiles();
  const sleepCalls: number[] = [];

  const deps: RunNeoProcessDeps = {
    argv: validRunArgv(),
    signals: signals.port,
    identity,
    sleep: {
      sleep: async (milliseconds: number) => {
        sleepCalls.push(milliseconds);
        await Promise.resolve();
      },
    },
    configReader: createInMemoryProductionConfigFileReader(configFiles),
    readiness,
    log,
    ...overrides,
  };

  return { deps, signals, readiness, log };
};

export const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};
