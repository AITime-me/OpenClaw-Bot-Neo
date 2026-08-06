/** Codex app-server JSONL protocol helpers (Build 3.7E1 probe-only). */

export const FIXED_PROBE_PROMPT =
  'Return one JSON object with ok=true and no other fields.' as const;

export const EXACT_OK_TRUE_OUTPUT = Object.freeze({ ok: true as const });

export const CLI_AUTH_CREDENTIALS_STORE = 'file' as const;

export const CLIENT_REQUEST_METHODS = Object.freeze([
  'initialize',
  'config/read',
  'configRequirements/read',
  'account/read',
  'account/rateLimits/read',
  'model/list',
  'thread/start',
  'turn/start',
  'turn/interrupt',
  'thread/unsubscribe',
] as const);

export type ClientRequestMethod = (typeof CLIENT_REQUEST_METHODS)[number];

export const CLIENT_NOTIFICATION_METHODS = Object.freeze(['initialized'] as const);

export const ALLOWED_SERVER_NOTIFICATION_METHODS = Object.freeze([
  'thread/started',
  'turn/started',
  'turn/completed',
  'item/started',
  'item/completed',
  'item/agentMessage/delta',
] as const);

export const FORBIDDEN_POST_DISPATCH_EVENTS = Object.freeze([
  'model/rerouted',
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
  'item/permissions/requestApproval',
] as const);

export type JsonRpcId = number | string;

export type JsonRpcRequest = {
  readonly method: string;
  readonly id: JsonRpcId;
  readonly params?: unknown;
};

export type JsonRpcNotification = {
  readonly method: string;
  readonly params?: unknown;
};

export type JsonRpcSuccess = {
  readonly id: JsonRpcId;
  readonly result: unknown;
};

export type JsonRpcFailure = {
  readonly id: JsonRpcId;
  readonly error: { readonly code?: number; readonly message?: string };
};

export type JsonRpcServerNotification = {
  readonly method: string;
  readonly params?: unknown;
};

export type ParsedFrame =
  | { readonly kind: 'success'; readonly value: JsonRpcSuccess }
  | { readonly kind: 'failure'; readonly value: JsonRpcFailure }
  | { readonly kind: 'notification'; readonly value: JsonRpcServerNotification }
  | { readonly kind: 'malformed'; readonly raw: string };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const serializeRequest = (request: JsonRpcRequest): string =>
  JSON.stringify({
    method: request.method,
    id: request.id,
    ...(request.params === undefined ? {} : { params: request.params }),
  });

export const serializeNotification = (notification: JsonRpcNotification): string =>
  JSON.stringify({
    method: notification.method,
    ...(notification.params === undefined ? {} : { params: notification.params }),
  });

export const parseJsonlFrame = (raw: string): ParsedFrame => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { kind: 'malformed', raw };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { kind: 'malformed', raw };
  }
  if (!isPlainObject(parsed)) return { kind: 'malformed', raw };
  const record = parsed;
  if ('id' in record && 'result' in record)
    return {
      kind: 'success',
      value: { id: record.id as JsonRpcId, result: record.result },
    };
  if ('id' in record && 'error' in record) {
    let errorValue: JsonRpcFailure['error'] = { message: 'unknown' };
    if (isPlainObject(record.error)) {
      errorValue = {
        ...(typeof record.error.code === 'number' ? { code: record.error.code } : {}),
        ...(typeof record.error.message === 'string' ? { message: record.error.message } : {}),
      };
    }
    return {
      kind: 'failure',
      value: {
        id: record.id as JsonRpcId,
        error: errorValue,
      },
    };
  }
  if (typeof record.method === 'string' && !('id' in record))
    return {
      kind: 'notification',
      value: { method: record.method, params: record.params },
    };
  return { kind: 'malformed', raw };
};

export const isExactOkTrueOutput = (text: string): boolean => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    return false;
  }
  if (!isPlainObject(parsed)) return false;
  const keys = Object.keys(parsed);
  if (keys.length !== 1 || keys[0] !== 'ok') return false;
  return parsed.ok === true;
};

export const isForbiddenPostDispatchMethod = (method: string): boolean => {
  if ((FORBIDDEN_POST_DISPATCH_EVENTS as readonly string[]).includes(method)) return true;
  if (method.startsWith('mcp') || method.includes('mcpServer')) return true;
  if (/shell|commandExecution|fileChange|webSearch|web_browser|browsing/i.test(method)) return true;
  return false;
};

export const isAllowedServerNotification = (method: string): boolean =>
  (ALLOWED_SERVER_NOTIFICATION_METHODS as readonly string[]).includes(method);
