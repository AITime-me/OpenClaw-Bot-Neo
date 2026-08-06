import type { LlmCompletionPort } from '../../../core/communication/ports/llm-completion.port.js';
import type { CodexAppServerRouteConfig } from './codex-app-server-config.js';
import { createCodexAppServerLlmCompletion } from './codex-app-server-llm-completion.js';
import {
  childEnvFromRouteConfig,
  runCodexAppServerCapabilityProbe,
  type CapabilityProbeOptions,
} from './codex-app-server-capability-probe.js';
import type { CodexAppServerTransport } from './codex-app-server-client.js';

export type CodexAppServerRoute = {
  readonly llm: LlmCompletionPort;
  readonly runCapabilityProbe: typeof runCodexAppServerCapabilityProbe;
  readonly config: CodexAppServerRouteConfig;
};

/**
 * Package-private probe-only route factory. Not wired to durable 3.7D, channel adapters, or production.
 */
export const createCodexAppServerRoute = (
  config: CodexAppServerRouteConfig,
  options?: { readonly transport?: CodexAppServerTransport },
): CodexAppServerRoute => {
  const llm = createCodexAppServerLlmCompletion({
    pin: config.pin,
    envInput: childEnvFromRouteConfig(config),
    ...(options?.transport !== undefined ? { transport: options.transport } : {}),
    ...(config.timeouts !== undefined ? { timeouts: config.timeouts } : {}),
  });
  return {
    llm,
    config,
    runCapabilityProbe: (probeOptions: CapabilityProbeOptions) => {
      const transport = probeOptions.transport ?? options?.transport;
      return runCodexAppServerCapabilityProbe({
        ...probeOptions,
        config: probeOptions.config ?? config,
        ...(transport !== undefined ? { transport } : {}),
      });
    },
  };
};
