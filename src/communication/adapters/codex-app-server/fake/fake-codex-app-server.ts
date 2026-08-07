import type { CodexAppServerTransport } from '../codex-app-server-client.js';
import {
  FIXED_PROBE_PROMPT,
  parseJsonlFrame,
  serializeRequest,
  type JsonRpcId,
} from '../codex-app-server-protocol.js';

export type FakeCodexAppServerScenario =
  | 'happy-path'
  | 'account-null'
  | 'non-chatgpt-auth'
  | 'effective-config-violation'
  | 'unknown-config-key'
  | 'quota-exhausted'
  | 'empty-models'
  | 'multiple-models'
  | 'unsupported-models'
  | 'wrong-model-provider'
  | 'model-rerouted'
  | 'abort-before-dispatch'
  | 'initialize-timeout'
  | 'thread-start-timeout'
  | 'malformed-before-dispatch'
  | 'abort-after-dispatch'
  | 'timeout-after-dispatch'
  | 'crash-after-dispatch'
  | 'malformed-after-dispatch'
  | 'web-event-after-dispatch'
  | 'file-event-after-dispatch'
  | 'shell-event-after-dispatch'
  | 'mcp-event-after-dispatch'
  | 'invalid-output'
  | 'cleanup-spawned-no-thread'
  | 'cleanup-thread-no-dispatch'
  | 'cleanup-active-turn'
  | 'cleanup-child-crashed'
  | 'duplicate-response-id'
  | 'late-response'
  | 'result-and-error'
  | 'server-request-before-dispatch'
  | 'server-request-after-dispatch'
  | 'forbidden-item-command'
  | 'forbidden-item-file'
  | 'forbidden-item-web'
  | 'forbidden-item-mcp'
  | 'turn-failed'
  | 'turn-interrupted'
  | 'wrong-turn-id'
  | 'wrong-thread-id'
  | 'wrong-event-order'
  | 'item-before-turn-started'
  | 'hung-stdin-write'
  | 'stdin-write-fail'
  | 'delayed-stdin-write'
  | 'unknown-response-id'
  | 'typed-id-mismatch'
  | 'protocol-failure-cleanup';

type FakeController = {
  readonly scenario: FakeCodexAppServerScenario;
  readonly rpcTrace: string[];
  readonly interruptParams: unknown[];
  readonly turnStartParams: unknown[];
  readonly threadStartParams: unknown[];
  triggerAbort(): void;
  forceExit(code?: number): void;
};

export type FakeCodexAppServerHandle = {
  readonly transport: CodexAppServerTransport;
  readonly controller: FakeController;
  readonly getAbortSignal: () => AbortSignal;
};

const happyAccount = {
  account: { type: 'chatgpt', email: 'owner@example.com', planType: 'plus' },
  requiresOpenaiAuth: true,
};

const happyConfig = {
  config: {
    cli_auth_credentials_store: 'file',
    forced_login_method: 'chatgpt',
    model_provider: 'openai',
    model: 'gpt-probe',
    approval_policy: 'never',
    sandbox: 'readOnly',
    mcpServers: {},
    web: false,
    shell: false,
    search: false,
    apps: { _default: { enabled: false } },
    hooks: false,
  },
};

const happyLimits = {
  rateLimits: {
    limitId: 'codex',
    limitName: null,
    primary: { usedPercent: 10, windowDurationMins: 15, resetsAt: 1_900_000_000 },
    secondary: null,
    rateLimitReachedType: null,
  },
  rateLimitsByLimitId: {
    codex: {
      limitId: 'codex',
      limitName: null,
      primary: { usedPercent: 10, windowDurationMins: 15, resetsAt: 1_900_000_000 },
      secondary: null,
      rateLimitReachedType: null,
    },
  },
};

const happyModels = {
  data: [
    {
      id: 'gpt-probe',
      model: 'gpt-probe',
      displayName: 'Probe',
      hidden: false,
      isDefault: true,
      inputModalities: ['text'],
    },
  ],
  nextCursor: null,
};

export const createFakeCodexAppServerTransport = (
  scenario: FakeCodexAppServerScenario,
): FakeCodexAppServerHandle => {
  const lineHandlers: Array<(line: string) => void> = [];
  const exitHandlers: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = [];
  let exited = false;
  let stdinClosed = false;
  const abort = new AbortController();
  let threadId: string | null = null;
  const rpcTrace: string[] = [];
  const interruptParams: unknown[] = [];
  const turnStartParams: unknown[] = [];
  const threadStartParams: unknown[] = [];
  const stderrBuf = '';
  let delayedWrite: Promise<void> | null = null;

  const emitLine = (line: string): void => {
    queueMicrotask(() => {
      for (const handler of lineHandlers) handler(line);
    });
  };

  const respond = (id: JsonRpcId, result: unknown): void => {
    emitLine(JSON.stringify({ id, result }));
  };

  const respondError = (id: JsonRpcId, message: string): void => {
    emitLine(JSON.stringify({ id, error: { message } }));
  };

  const notify = (method: string, params: unknown): void => {
    emitLine(JSON.stringify({ method, params }));
  };

  const forceExit = (code: number | null = 1): void => {
    if (exited) return;
    exited = true;
    for (const handler of exitHandlers) handler(code, null);
  };

  const handleRequest = (method: string, id: JsonRpcId, params: unknown): void => {
    rpcTrace.push(method);
    if (scenario === 'initialize-timeout' && method === 'initialize') return;
    if (scenario === 'thread-start-timeout' && method === 'thread/start') return;
    if (scenario === 'malformed-before-dispatch' && method === 'initialize') {
      emitLine('not-json{');
      return;
    }
    if (scenario === 'result-and-error' && method === 'initialize') {
      emitLine(JSON.stringify({ id, result: {}, error: { message: 'both' } }));
      return;
    }
    if (scenario === 'duplicate-response-id' && method === 'initialize') {
      respond(id, { serverInfo: { name: 'fake' } });
      respond(id, { serverInfo: { name: 'dup' } });
      return;
    }
    if (scenario === 'unknown-response-id' && method === 'initialize') {
      respond(999, { serverInfo: { name: 'fake' } });
      return;
    }
    if (scenario === 'typed-id-mismatch' && method === 'initialize') {
      respond(String(id), { serverInfo: { name: 'fake' } });
      return;
    }
    if (scenario === 'late-response' && method === 'config/read') {
      respond(1, { serverInfo: { name: 'late-initialize' } });
      respond(id, happyConfig);
      return;
    }
    if (scenario === 'late-response' && method === 'initialize') {
      respond(id, { serverInfo: { name: 'fake' } });
      return;
    }
    if (scenario === 'server-request-before-dispatch' && method === 'initialize') {
      emitLine(
        JSON.stringify({
          method: 'item/commandExecution/requestApproval',
          id: 'srv_1',
          params: {},
        }),
      );
      return;
    }
    if (scenario === 'cleanup-spawned-no-thread' && method === 'initialize') {
      respond(id, { serverInfo: { name: 'fake' } });
      forceExit(0);
      return;
    }
    if (scenario === 'cleanup-child-crashed' && method === 'initialize') {
      forceExit(1);
      return;
    }
    if (scenario === 'protocol-failure-cleanup' && method === 'initialize') {
      respond(id, { serverInfo: { name: 'fake' } });
      return;
    }

    switch (method) {
      case 'initialize':
        respond(id, { serverInfo: { name: 'fake-codex' } });
        return;
      case 'config/read':
        if (scenario === 'effective-config-violation') {
          respond(id, {
            config: {
              ...happyConfig.config,
              web: true,
              mcpServers: { x: {} },
              apps: { demo: { enabled: true } },
            },
          });
          return;
        }
        if (scenario === 'unknown-config-key') {
          respond(id, {
            config: {
              ...happyConfig.config,
              experimentalAgenticSurface: true,
            },
          });
          return;
        }
        respond(id, happyConfig);
        return;
      case 'configRequirements/read':
        respond(id, { requirements: null });
        return;
      case 'account/read':
        if (scenario === 'account-null') {
          respond(id, { account: null, requiresOpenaiAuth: true });
          return;
        }
        if (scenario === 'non-chatgpt-auth') {
          respond(id, { account: { type: 'apiKey' }, requiresOpenaiAuth: true });
          return;
        }
        respond(id, happyAccount);
        return;
      case 'account/rateLimits/read':
        if (scenario === 'quota-exhausted') {
          respond(id, {
            rateLimits: {
              limitId: 'codex',
              primary: { usedPercent: 100, windowDurationMins: 15, resetsAt: 1 },
              secondary: null,
              rateLimitReachedType: 'primary',
            },
          });
          return;
        }
        respond(id, happyLimits);
        return;
      case 'model/list':
        if (scenario === 'empty-models') {
          respond(id, { data: [], nextCursor: null });
          return;
        }
        if (scenario === 'multiple-models') {
          respond(id, {
            data: [
              {
                id: 'a',
                isDefault: true,
                hidden: false,
                inputModalities: ['text'],
              },
              {
                id: 'b',
                isDefault: true,
                hidden: false,
                inputModalities: ['text'],
              },
            ],
            nextCursor: null,
          });
          return;
        }
        if (scenario === 'unsupported-models') {
          respond(id, {
            data: [
              {
                id: 'vision-only',
                isDefault: true,
                hidden: false,
                inputModalities: ['image'],
              },
            ],
            nextCursor: null,
          });
          return;
        }
        respond(id, happyModels);
        return;
      case 'thread/start':
        threadStartParams.push(params);
        threadId = 'thr_fake_1';
        respond(id, {
          thread: {
            id: threadId,
            ephemeral: true,
            preview: '',
            createdAt: 1,
            modelProvider: scenario === 'wrong-model-provider' ? 'azure' : 'openai',
          },
        });
        notify('thread/started', { thread: { id: threadId } });
        return;
      case 'turn/start': {
        turnStartParams.push(params);
        const input = (params as { input?: Array<{ text?: string }> }).input;
        const text = input?.[0]?.text ?? '';
        if (text !== FIXED_PROBE_PROMPT) {
          respondError(id, 'unexpected-prompt');
          return;
        }
        respond(id, { turn: { id: 'turn_1', status: 'inProgress', items: [] } });
        if (scenario === 'wrong-event-order') {
          notify('item/completed', {
            item: { type: 'agentMessage', id: 'i1', text: '{"ok":true}' },
            threadId,
            turnId: 'turn_1',
          });
          notify('turn/completed', {
            turn: { id: 'turn_1', status: 'completed', items: [] },
            threadId,
          });
          return;
        }
        if (scenario === 'item-before-turn-started') {
          notify('item/completed', {
            item: { type: 'agentMessage', id: 'i1', text: '{"ok":true}' },
            threadId,
            turnId: 'turn_1',
          });
          notify('turn/started', {
            turn: { id: 'turn_1', status: 'inProgress', items: [] },
            threadId,
          });
          notify('turn/completed', {
            turn: { id: 'turn_1', status: 'completed', items: [] },
            threadId,
          });
          return;
        }
        notify('turn/started', {
          turn: { id: 'turn_1', status: 'inProgress', items: [] },
          threadId,
        });
        if (scenario === 'delayed-stdin-write') {
          return;
        }
        if (scenario === 'protocol-failure-cleanup') {
          emitLine('{broken-after-dispatch');
          return;
        }
        if (scenario === 'server-request-after-dispatch') {
          emitLine(
            JSON.stringify({
              method: 'item/commandExecution/requestApproval',
              id: 'srv_2',
              params: { threadId },
            }),
          );
          return;
        }
        if (scenario === 'model-rerouted') {
          notify('model/rerouted', {
            threadId,
            turnId: 'turn_1',
            fromModel: 'gpt-probe',
            toModel: 'other',
            reason: 'test',
          });
          return;
        }
        if (scenario === 'web-event-after-dispatch') {
          notify('webSearch/started', {});
          return;
        }
        if (scenario === 'file-event-after-dispatch') {
          notify('item/fileChange/requestApproval', {});
          return;
        }
        if (scenario === 'shell-event-after-dispatch') {
          notify('item/commandExecution/requestApproval', {});
          return;
        }
        if (scenario === 'mcp-event-after-dispatch') {
          notify('mcpServer/tool/call', {});
          return;
        }
        if (scenario === 'forbidden-item-command') {
          notify('item/started', {
            item: { type: 'commandExecution', id: 'i1' },
            threadId,
            turnId: 'turn_1',
          });
          return;
        }
        if (scenario === 'forbidden-item-file') {
          notify('item/completed', {
            item: { type: 'fileChange', id: 'i1', changes: [] },
            threadId,
            turnId: 'turn_1',
          });
          return;
        }
        if (scenario === 'forbidden-item-web') {
          notify('item/completed', {
            item: { type: 'webSearch', id: 'i1', query: 'x' },
            threadId,
            turnId: 'turn_1',
          });
          return;
        }
        if (scenario === 'forbidden-item-mcp') {
          notify('item/completed', {
            item: { type: 'mcpToolCall', id: 'i1', server: 's', tool: 't', status: 'completed' },
            threadId,
            turnId: 'turn_1',
          });
          return;
        }
        if (scenario === 'malformed-after-dispatch') {
          emitLine('{broken');
          return;
        }
        if (scenario === 'crash-after-dispatch') {
          forceExit(1);
          return;
        }
        if (scenario === 'timeout-after-dispatch' || scenario === 'abort-after-dispatch') {
          return;
        }
        if (scenario === 'cleanup-active-turn') return;
        if (scenario === 'invalid-output') {
          notify('item/completed', {
            item: { type: 'agentMessage', id: 'i1', text: '{"ok":false}' },
            threadId,
            turnId: 'turn_1',
          });
          notify('turn/completed', {
            turn: { id: 'turn_1', status: 'completed', items: [] },
            threadId,
          });
          return;
        }
        if (scenario === 'turn-failed') {
          notify('item/completed', {
            item: { type: 'agentMessage', id: 'i1', text: '{"ok":true}' },
            threadId,
            turnId: 'turn_1',
          });
          notify('turn/completed', {
            turn: {
              id: 'turn_1',
              status: 'failed',
              error: { message: 'failed' },
              items: [],
            },
            threadId,
          });
          return;
        }
        if (scenario === 'turn-interrupted') {
          notify('turn/completed', {
            turn: { id: 'turn_1', status: 'interrupted', items: [] },
            threadId,
          });
          return;
        }
        if (scenario === 'wrong-turn-id') {
          notify('item/completed', {
            item: { type: 'agentMessage', id: 'i1', text: '{"ok":true}' },
            threadId,
            turnId: 'turn_1',
          });
          notify('turn/completed', {
            turn: { id: 'turn_OTHER', status: 'completed', items: [] },
            threadId,
          });
          return;
        }
        if (scenario === 'wrong-thread-id') {
          notify('item/completed', {
            item: { type: 'agentMessage', id: 'i1', text: '{"ok":true}' },
            threadId,
            turnId: 'turn_1',
          });
          notify('turn/completed', {
            turn: { id: 'turn_1', status: 'completed', items: [] },
            threadId: 'thr_OTHER',
          });
          return;
        }
        notify('item/completed', {
          item: { type: 'agentMessage', id: 'i1', text: '{"ok":true}' },
          threadId,
          turnId: 'turn_1',
        });
        notify('turn/completed', {
          turn: { id: 'turn_1', status: 'completed', items: [] },
          threadId,
        });
        return;
      }
      case 'turn/interrupt':
        interruptParams.push(params);
        respond(id, {});
        return;
      case 'thread/unsubscribe':
        respond(id, {});
        return;
      default:
        respondError(id, `unexpected-method:${method}`);
    }
  };

  const transport: CodexAppServerTransport = {
    writeLine(line) {
      if (scenario === 'stdin-write-fail')
        return Promise.reject(new Error('stdin-write-failed:test'));
      if (scenario === 'hung-stdin-write' && line.includes('"method":"turn/start"')) {
        return new Promise(() => {
          /* never settles */
        });
      }
      if (scenario === 'cleanup-thread-no-dispatch' && line.includes('"method":"turn/start"')) {
        queueMicrotask(() => {
          abort.abort();
        });
        return Promise.reject(new Error('aborted'));
      }
      if (exited || stdinClosed) return Promise.reject(new Error('stdin-closed'));

      const run = (): void => {
        const frame = parseJsonlFrame(line);
        if (frame.kind === 'notification') return;
        if (frame.kind === 'success' || frame.kind === 'failure') return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          return;
        }
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return;
        const record = parsed as Record<string, unknown>;
        if (typeof record.method === 'string' && 'id' in record) {
          handleRequest(record.method, record.id as JsonRpcId, record.params);
        }
      };

      if (scenario === 'delayed-stdin-write' && line.includes('"turn/start"')) {
        delayedWrite = new Promise((resolve) => {
          setTimeout(() => {
            run();
            resolve();
          }, 80);
        });
        return delayedWrite;
      }
      run();
      return Promise.resolve();
    },
    onLine(handler) {
      lineHandlers.push(handler);
    },
    onExit(handler) {
      exitHandlers.push(handler);
      if (exited) handler(1, null);
    },
    isExited: () => exited,
    kill() {
      forceExit(null);
    },
    closeStdin() {
      stdinClosed = true;
      if (!exited) forceExit(0);
    },
    dispose() {
      if (!exited) forceExit(null);
    },
    getStderrRedacted: () => stderrBuf,
    awaitReaped() {
      return Promise.resolve(exited);
    },
  };

  return {
    transport,
    controller: {
      scenario,
      rpcTrace,
      interruptParams,
      turnStartParams,
      threadStartParams,
      triggerAbort: () => {
        abort.abort();
      },
      forceExit: (code = 1) => {
        forceExit(code);
      },
    },
    getAbortSignal: () => abort.signal,
  };
};

/** Test helper keeps protocol import side stable for lint. */
export const _fakeProtocolTouch = (): string => serializeRequest({ method: 'initialize', id: 0 });
