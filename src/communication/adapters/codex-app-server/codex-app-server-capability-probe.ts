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
import { buildIsolatedProbeContour, readableRootsForProbe } from './codex-app-server-isolation.js';
import type { CodexOwnerSpawnCapability } from './codex-app-server-owner-capability.js';

export type CapabilityProbeOptions = {
  readonly config?: CodexAppServerRouteConfig;
  readonly transport?: CodexAppServerTransport;
  readonly abortSignal?: AbortSignal | null;
  readonly ownerCapability?: CodexOwnerSpawnCapability;
};

export const childEnvFromIsolation = (input: {
  readonly codexHome: string;
  readonly home: string;
  readonly tempDir: string;
  readonly lang?: string;
  readonly lcAll?: string;
  readonly tz?: string;
}): CodexAppServerChildEnvInput => ({
  codexHome: input.codexHome,
  home: input.home,
  tempDir: input.tempDir,
  ...(input.lang !== undefined ? { lang: input.lang } : {}),
  ...(input.lcAll !== undefined ? { lcAll: input.lcAll } : {}),
  ...(input.tz !== undefined ? { tz: input.tz } : {}),
});

const isolationInputFromConfig = (config: CodexAppServerRouteConfig) => ({
  codexHome: config.codexHome,
  repositoryRoot: config.repositoryRoot,
  ...(config.home !== undefined ? { home: config.home } : {}),
  ...(config.tempDir !== undefined ? { tempDir: config.tempDir } : {}),
  ...(config.probeCwd !== undefined ? { probeCwd: config.probeCwd } : {}),
});

/**
 * Owner-gated capability probe entry. Does not read credential files, does not log prompt/output,
 * and does not write Neo SQLite rows. Live spawn requires a one-shot owner capability.
 */
export const runCodexAppServerCapabilityProbe = async (
  options: CapabilityProbeOptions,
): Promise<Result<LlmCompletionResult, CommunicationError>> => {
  let transport = options.transport;
  let probeCwd: string;
  let readableRoots: readonly string[];

  if (transport === undefined) {
    if (options.config === undefined)
      return err(
        communicationError('CONFIG_INVALID', 'capability probe requires config or transport'),
      );
    if (options.ownerCapability === undefined)
      return err(
        communicationError('CONFIG_INVALID', 'live Codex spawn requires one-shot owner capability'),
      );
    const isolated = buildIsolatedProbeContour(isolationInputFromConfig(options.config));
    if (!isolated.ok) return err(communicationError('CONFIG_INVALID', isolated.reason));
    probeCwd = isolated.paths.probeCwd;
    readableRoots = readableRootsForProbe(isolated.paths);
    const created = createChildProcessTransport({
      pin: options.config.pin,
      envInput: childEnvFromIsolation({
        codexHome: isolated.paths.codexHome,
        home: isolated.paths.home,
        tempDir: isolated.paths.tempDir,
        ...(options.config.lang !== undefined ? { lang: options.config.lang } : {}),
        ...(options.config.lcAll !== undefined ? { lcAll: options.config.lcAll } : {}),
        ...(options.config.tz !== undefined ? { tz: options.config.tz } : {}),
      }),
      cwd: isolated.paths.probeCwd,
      readVersion: options.config.readVersion,
      ownerCapability: options.ownerCapability,
    });
    if (!created.ok) return err(communicationError('CONFIG_INVALID', created.reason));
    transport = created.transport;
  } else if (options.config !== undefined) {
    const isolated = buildIsolatedProbeContour(isolationInputFromConfig(options.config));
    if (!isolated.ok) return err(communicationError('CONFIG_INVALID', isolated.reason));
    probeCwd = isolated.paths.probeCwd;
    readableRoots = readableRootsForProbe(isolated.paths);
  } else {
    probeCwd = '/tmp/neo-fake-probe-cwd';
    readableRoots = [probeCwd];
  }

  const result = await runCapabilityProbeOnTransport({
    transport,
    abortSignal: options.abortSignal ?? null,
    probeCwd,
    readableRoots,
    ...(options.config?.timeouts !== undefined ? { timeouts: options.config.timeouts } : {}),
  });
  if (result.kind === 'config-error')
    return err(communicationError('CONFIG_INVALID', result.reason));
  return ok(result.value);
};
