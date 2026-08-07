import type { LlmCompletionPort } from '../../../core/communication/ports/llm-completion.port.js';
import type { CodexAppServerRouteConfig } from './codex-app-server-config.js';
import { createCodexAppServerLlmCompletion } from './codex-app-server-llm-completion.js';
import {
  childEnvFromIsolation,
  runCodexAppServerCapabilityProbe,
  type CapabilityProbeOptions,
} from './codex-app-server-capability-probe.js';
import type { CodexAppServerTransport } from './codex-app-server-client.js';
import {
  buildIsolatedProbeContour,
  readableRootsForProbe,
  validateModelReadableRoots,
} from './codex-app-server-isolation.js';
import type { CodexOwnerSpawnCapability } from './codex-app-server-owner-capability.js';

export type CodexAppServerRoute = {
  readonly llm: LlmCompletionPort;
  readonly runCapabilityProbe: typeof runCodexAppServerCapabilityProbe;
  readonly config: CodexAppServerRouteConfig;
};

/**
 * Package-private probe-only route factory. Not wired to durable 3.7D, channel adapters, or production.
 * Live spawn is impossible without an owner capability passed to runCapabilityProbe / llm deps.
 * Does not import or expose issueOwnerSpawnCapability.
 */
export const createCodexAppServerRoute = (
  config: CodexAppServerRouteConfig,
  options?: {
    readonly transport?: CodexAppServerTransport;
    readonly ownerCapability?: CodexOwnerSpawnCapability;
  },
): CodexAppServerRoute => {
  const isolated = buildIsolatedProbeContour({
    codexHome: config.codexHome,
    repositoryRoot: config.repositoryRoot,
    ...(config.home !== undefined ? { home: config.home } : {}),
    ...(config.tempDir !== undefined ? { tempDir: config.tempDir } : {}),
    ...(config.probeCwd !== undefined ? { probeCwd: config.probeCwd } : {}),
  });
  const readableRoots =
    isolated.ok &&
    validateModelReadableRoots(readableRootsForProbe(isolated.paths), isolated.paths).ok
      ? readableRootsForProbe(isolated.paths)
      : undefined;

  const llm = createCodexAppServerLlmCompletion({
    ...(options?.transport !== undefined ? { transport: options.transport } : {}),
    ...(config.timeouts !== undefined ? { timeouts: config.timeouts } : {}),
    ...(isolated.ok && readableRoots !== undefined
      ? {
          pin: config.pin,
          envInput: childEnvFromIsolation({
            codexHome: isolated.paths.codexHome,
            home: isolated.paths.home,
            tempDir: isolated.paths.tempDir,
            ...(config.lang !== undefined ? { lang: config.lang } : {}),
            ...(config.lcAll !== undefined ? { lcAll: config.lcAll } : {}),
            ...(config.tz !== undefined ? { tz: config.tz } : {}),
          }),
          cwd: isolated.paths.probeCwd,
          readableRoots,
          isolationPaths: isolated.paths,
          readVersion: config.readVersion,
        }
      : {}),
    ...(options?.ownerCapability !== undefined ? { ownerCapability: options.ownerCapability } : {}),
  });

  return {
    llm,
    config,
    runCapabilityProbe: (probeOptions: CapabilityProbeOptions) => {
      const transport = probeOptions.transport ?? options?.transport;
      const ownerCapability = probeOptions.ownerCapability ?? options?.ownerCapability;
      return runCodexAppServerCapabilityProbe({
        ...probeOptions,
        config: probeOptions.config ?? config,
        ...(transport !== undefined ? { transport } : {}),
        ...(ownerCapability !== undefined ? { ownerCapability } : {}),
      });
    },
  };
};
