import { err, ok, type Result } from '../../../core/domain/result.js';
import type { OperationContext } from '../../../core/domain/operation-context.js';
import {
  communicationError,
  type CommunicationError,
} from '../../../core/communication/domain/communication-errors.js';
import type { LlmCompletionPort } from '../../../core/communication/ports/llm-completion.port.js';
import type {
  LlmCompletionRequest,
  LlmCompletionResult,
} from '../../../core/communication/domain/llm-completion.js';
import type { CodexAppServerTimeouts } from './codex-app-server-config.js';
import {
  createChildProcessTransport,
  runCapabilityProbeOnTransport,
  type CodexAppServerTransport,
} from './codex-app-server-client.js';
import type { CodexExecutablePin } from './codex-app-server-executable-pin.js';
import type { CodexAppServerChildEnvInput } from './codex-app-server-child-env.js';
import type { CodexOwnerSpawnCapability } from './codex-app-server-owner-capability.js';
import type { VersionReader } from './codex-app-server-executable-pin.js';

export type CodexAppServerLlmCompletionDeps = {
  readonly transport?: CodexAppServerTransport;
  readonly pin?: CodexExecutablePin;
  readonly envInput?: CodexAppServerChildEnvInput;
  readonly cwd?: string;
  readonly readableRoots?: readonly string[];
  readonly readVersion?: VersionReader;
  readonly ownerCapability?: CodexOwnerSpawnCapability;
  readonly timeouts?: Partial<CodexAppServerTimeouts>;
};

/**
 * Probe-only LlmCompletionPort. Always sends FIXED_PROBE_PROMPT (never logs prompt/output).
 * Does not persist to Neo SQLite. Live spawn requires owner capability.
 */
export const createCodexAppServerLlmCompletion = (
  deps: CodexAppServerLlmCompletionDeps,
): LlmCompletionPort => ({
  async complete(
    request: LlmCompletionRequest,
    _operationContext: OperationContext,
  ): Promise<Result<LlmCompletionResult, CommunicationError>> {
    void _operationContext;
    let transport = deps.transport;
    let probeCwd = deps.cwd ?? '/tmp/neo-fake-probe-cwd';
    let readableRoots = deps.readableRoots ?? [probeCwd];

    if (transport === undefined) {
      if (
        deps.pin === undefined ||
        deps.envInput === undefined ||
        deps.cwd === undefined ||
        deps.readVersion === undefined ||
        deps.ownerCapability === undefined
      )
        return err(
          communicationError(
            'CONFIG_INVALID',
            'live Codex probe requires pin+env+cwd+readVersion+ownerCapability (or fake transport)',
          ),
        );
      const created = createChildProcessTransport({
        pin: deps.pin,
        envInput: deps.envInput,
        cwd: deps.cwd,
        readVersion: deps.readVersion,
        ownerCapability: deps.ownerCapability,
      });
      if (!created.ok) return err(communicationError('CONFIG_INVALID', created.reason));
      transport = created.transport;
      probeCwd = deps.cwd;
      readableRoots = deps.readableRoots ?? [deps.cwd];
    }

    const result = await runCapabilityProbeOnTransport({
      transport,
      abortSignal: request.abortSignal,
      probeCwd,
      readableRoots,
      ...(deps.timeouts !== undefined ? { timeouts: deps.timeouts } : {}),
    });
    if (result.kind === 'config-error')
      return err(communicationError('CONFIG_INVALID', result.reason));
    return ok(result.value);
  },
});
