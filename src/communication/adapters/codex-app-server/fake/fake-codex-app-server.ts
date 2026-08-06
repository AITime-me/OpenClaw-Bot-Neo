import type { CodexAppServerTransport } from '../codex-app-server-client.js';
import {
  FIXED_PROBE_PROMPT,
  parseJsonlFrame,
  serializeRequest,
  type JsonRpcId,
} from '../codex-app-server-protocol.js';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export type FakeCodexAppServerScenario =
  | 'happy-path'
  | 'account-null'
  | 'non-chatgpt-auth'
  | 'effective-config-violation'
  | 'quota-exhausted'
  | 'empty-models'
  | 'multiple-models'
  | 'unsupported-models'
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
  | 'cleanup-child-crashed';

type FakeController = {
  readonly scenario: FakeCodexAppServerScenario;
  triggerAbort(): void;
  forceExit(code?: number): void;
};

export type FakeCodexAppServerHandle = {
  readonly transport: CodexAppServerTransport;
  readonly controller: FakeController;
  readonly getAbortSignal: () => AbortSignal;
};

export const createFakeCodexAppServerTransport = (
  scenario: FakeCodexAppServerScenario,
): FakeCodexAppServerHandle => {
  const lineHandlers: Array<(line: string) => void> = [];
  const exitHandlers: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = [];
  let exited = false;
  let stdinClosed = false;
  const abort = new AbortController();
  let turnStarted = false;
  let threadId: string | null = null;

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
    if (scenario === 'initialize-timeout' && method === 'initialize') return;
    if (scenario === 'thread-start-timeout' && method === 'thread/start') return;
    if (scenario === 'malformed-before-dispatch' && method === 'initialize') {
      emitLine('not-json{');
      return;
    }
    if (scenario === 'cleanup-spawned-no-thread' && method === 'initialize') {
      respond(id, { ok: true });
      forceExit(0);
      return;
    }
    if (scenario === 'cleanup-child-crashed' && method === 'initialize') {
      forceExit(1);
      return;
    }

    switch (method) {
      case 'initialize':
        respond(id, { serverInfo: { name: 'fake-codex' } });
        return;
      case 'config/read':
        if (scenario === 'effective-config-violation') {
          respond(id, { web: true, mcpServers: { x: {} } });
          return;
        }
        respond(id, { mcpServers: {}, web: false, shell: false, apps: false, hooks: false });
        return;
      case 'configRequirements/read':
        respond(id, {});
        return;
      case 'account/read':
        if (scenario === 'account-null') {
          respond(id, null);
          return;
        }
        if (scenario === 'non-chatgpt-auth') {
          respond(id, { type: 'api' });
          return;
        }
        respond(id, { type: 'chatgpt' });
        return;
      case 'account/rateLimits/read':
        if (scenario === 'quota-exhausted') {
          respond(id, { remaining: 0, exhausted: true });
          return;
        }
        respond(id, { remaining: 10, exhausted: false });
        return;
      case 'model/list':
        if (scenario === 'empty-models') {
          respond(id, { models: [] });
          return;
        }
        if (scenario === 'multiple-models') {
          respond(id, {
            models: [
              { id: 'a', textCapable: true },
              { id: 'b', textCapable: true },
            ],
          });
          return;
        }
        if (scenario === 'unsupported-models') {
          respond(id, { models: [{ id: 'vision-only', textCapable: false }] });
          return;
        }
        respond(id, { models: [{ id: 'gpt-probe', textCapable: true }] });
        return;
      case 'thread/start':
        threadId = 'thr_fake_1';
        respond(id, { thread: { id: threadId, ephemeral: true } });
        notify('thread/started', { thread: { id: threadId } });
        if (scenario === 'cleanup-thread-no-dispatch') {
          queueMicrotask(() => {
            abort.abort();
          });
          return;
        }
        return;
      case 'turn/start': {
        turnStarted = true;
        const input = (params as { input?: Array<{ text?: string }> }).input;
        const text = input?.[0]?.text ?? '';
        if (text !== FIXED_PROBE_PROMPT) {
          respondError(id, 'unexpected-prompt');
          return;
        }
        respond(id, { turn: { id: 'turn_1' } });
        notify('turn/started', { turn: { id: 'turn_1' } });
        if (scenario === 'model-rerouted') {
          notify('model/rerouted', { from: 'gpt-probe', to: 'other' });
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
        if (scenario === 'invalid-output') {
          notify('item/completed', {
            item: { type: 'agentMessage', text: '{"ok":false}' },
          });
          notify('turn/completed', { turn: { id: 'turn_1' } });
          return;
        }
        if (scenario === 'cleanup-active-turn') {
          return;
        }
        notify('item/completed', {
          item: { type: 'agentMessage', text: '{"ok":true}' },
        });
        notify('turn/completed', { turn: { id: 'turn_1' } });
        return;
      }
      case 'turn/interrupt':
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
      if (exited || stdinClosed) return;
      // Client JSON-RPC requests carry both method+id; parseJsonlFrame marks those malformed.
      // Accept notifications (initialized) and ignore success/failure echoes.
      const frame = parseJsonlFrame(line);
      if (frame.kind === 'notification') return;
      if (frame.kind === 'success' || frame.kind === 'failure') return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return;
      }
      if (!isPlainObject(parsed)) return;
      if (typeof parsed.method === 'string' && 'id' in parsed) {
        handleRequest(parsed.method, parsed.id as JsonRpcId, parsed.params);
      }
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
      if (scenario === 'cleanup-spawned-no-thread' || scenario === 'cleanup-thread-no-dispatch') {
        forceExit(0);
        return;
      }
      if (!exited && (scenario === 'happy-path' || turnStarted)) forceExit(0);
      else if (!exited) forceExit(0);
    },
    dispose() {
      if (!exited) forceExit(null);
    },
  };

  return {
    transport,
    controller: {
      scenario,
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

/** Test helper: unused serializeRequest keeps protocol import side stable for lint. */
export const _fakeProtocolTouch = (): string => serializeRequest({ method: 'initialize', id: 0 });
