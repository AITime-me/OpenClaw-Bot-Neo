import { err, ok, type Result } from '../../../core/domain/result.js';
import {
  communicationError,
  type CommunicationError,
} from '../../../core/communication/domain/communication-errors.js';
import type { LlmCompletionResult } from '../../../core/communication/domain/llm-completion.js';
import type { CodexAppServerRouteConfig } from './codex-app-server-config.js';
import type { CodexAppServerChildEnvInput } from './codex-app-server-child-env.js';
import {
  createChildProcessTransport,
  runCapabilityProbeOnTransport,
  type CodexAppServerTransport,
} from './codex-app-server-client.js';

export type CapabilityProbeOptions = {
  readonly config?: CodexAppServerRouteConfig;
  readonly transport?: CodexAppServerTransport;
  readonly abortSignal?: AbortSignal | null;
};

export const childEnvFromRouteConfig = (
  config: CodexAppServerRouteConfig,
): CodexAppServerChildEnvInput => ({
  codexHome: config.codexHome,
  ...(config.home !== undefined ? { home: config.home } : {}),
  ...(config.lang !== undefined ? { lang: config.lang } : {}),
  ...(config.lcAll !== undefined ? { lcAll: config.lcAll } : {}),
  ...(config.tz !== undefined ? { tz: config.tz } : {}),
});

/**
 * Owner-gated capability probe entry. Does not read credential files, does not log prompt/output,
 * and does not write Neo SQLite rows.
 */
export const runCodexAppServerCapabilityProbe = async (
  options: CapabilityProbeOptions,
): Promise<Result<LlmCompletionResult, CommunicationError>> => {
  let transport = options.transport;
  if (transport === undefined) {
    if (options.config === undefined)
      return err(
        communicationError('CONFIG_INVALID', 'capability probe requires config or transport'),
      );
    const created = createChildProcessTransport(
      options.config.pin,
      childEnvFromRouteConfig(options.config),
    );
    if (!created.ok) return err(communicationError('CONFIG_INVALID', created.reason));
    transport = created.transport;
  }
  const result = await runCapabilityProbeOnTransport({
    transport,
    abortSignal: options.abortSignal ?? null,
    ...(options.config?.timeouts !== undefined ? { timeouts: options.config.timeouts } : {}),
  });
  if (result.kind === 'config-error')
    return err(communicationError('CONFIG_INVALID', result.reason));
  return ok(result.value);
};
