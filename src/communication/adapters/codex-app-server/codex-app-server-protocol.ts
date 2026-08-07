/** Official Codex app-server JSONL protocol helpers (Build 3.7E1 corrective). */

export const FIXED_PROBE_PROMPT =
  'Return one JSON object with ok=true and no other fields.' as const;

export const EXACT_OK_TRUE_OUTPUT = Object.freeze({ ok: true as const });

export const CLI_AUTH_CREDENTIALS_STORE = 'file' as const;
export const FORCED_LOGIN_METHOD = 'chatgpt' as const;
export const APPROVED_MODEL_PROVIDER = 'openai' as const;
/**
 * Config field `sandbox_mode` vocabulary (Codex `SandboxMode` enum).
 * Distinct from SandboxPolicy.type (`readOnly`) and from thread/start wire below.
 */
export const APPROVED_CONFIG_SANDBOX_MODE = 'read-only' as const;
/**
 * `thread/start.sandbox` wire token — Codex 0.147.0 `SandboxMode` (kebab-case).
 * Not `readOnly` (that is SandboxPolicy.type only).
 */
export const APPROVED_THREAD_SANDBOX_MODE = 'read-only' as const;
/** Codex 0.147.0 `SandboxPolicy.type` for turn/start when legacy policy is used. */
export const APPROVED_SANDBOX_POLICY_TYPE = 'readOnly' as const;
/** @deprecated Use APPROVED_CONFIG_SANDBOX_MODE / APPROVED_THREAD_SANDBOX_MODE. */
export const APPROVED_SANDBOX_MODE = APPROVED_CONFIG_SANDBOX_MODE;
/** Codex 0.147.0 `WebSearchMode` — null is not safe. */
export const APPROVED_WEB_SEARCH_MODE = 'disabled' as const;
export const APPROVED_APPROVAL_POLICY = 'never' as const;

/**
 * Named permissions profile for probeCwd-only read, no write, no network.
 * Required because legacy sandbox_mode/readOnly implies full filesystem read on Windows
 * and SandboxPolicy.readOnly has no readableRoots field in 0.147.0.
 */
export const PROBE_PERMISSIONS_PROFILE_ID = 'neo-probe-cwd-readonly' as const;

/** Official SandboxMode enum values from generate-ts / JSON schema. */
export const THREAD_SANDBOX_MODE_ENUM = Object.freeze([
  'read-only',
  'workspace-write',
  'danger-full-access',
] as const);

export const isThreadSandboxModeWireToken = (
  value: unknown,
): value is (typeof THREAD_SANDBOX_MODE_ENUM)[number] =>
  typeof value === 'string' && (THREAD_SANDBOX_MODE_ENUM as readonly string[]).includes(value);

/**
 * Live Codex on native Windows cannot guarantee probeCwd-only confidentiality:
 * legacy readOnly = full FS read; split/permissions needs elevated Windows sandbox
 * which Neo probe does not guarantee. Fail closed for live spawn/retry.
 */
export const probeLiveFilesystemBoundarySupported = (): boolean => process.platform !== 'win32';

/**
 * Notifications suppressed via `initialize.capabilities.optOutNotificationMethods`
 * (Codex 0.147.0 `InitializeCapabilities`).
 */
export const OPT_OUT_NOTIFICATION_METHODS = Object.freeze([
  'remoteControl/status/changed',
] as const);

/**
 * Feature flags that must not be enabled for the probe (agentic / remote surfaces).
 * Presence with value `true` is fail-closed; absent/false is acceptable.
 */
export const FORBIDDEN_ENABLED_FEATURES = Object.freeze([
  'remote_plugin',
  'tool_suggest',
  'auth_elicitation',
] as const);

/** Top-level config booleans that enable agentic/tool surfaces when true. */
export const FORBIDDEN_ENABLED_CONFIG_FLAGS = Object.freeze([
  'experimental_use_unified_exec_tool',
  'experimental_unified_exec_tool',
] as const);

/** Known base-URL keys — null/absent is safe; non-empty override is not. */
export const BASE_URL_CONFIG_KEYS = Object.freeze([
  'openai_base_url',
  'chatgpt_base_url',
  'base_url',
  'baseUrl',
] as const);

/** @deprecated Retained for tests that assert the old full-key allowlist was removed. */
export const ALLOWED_CONFIG_KEYS = Object.freeze([
  'cli_auth_credentials_store',
  'forced_login_method',
  'model_provider',
  'model',
  'approval_policy',
  'sandbox_mode',
  'web_search',
  'allow_login_shell',
  'tools',
  'apps',
  'mcp_servers',
  'mcpServers',
  'hooks',
  'features',
] as const);

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

export const ALLOWED_ITEM_TYPES = Object.freeze(['agentMessage', 'userMessage'] as const);

export const FORBIDDEN_POST_DISPATCH_EVENTS = Object.freeze([
  'model/rerouted',
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
  'item/permissions/requestApproval',
] as const);

export const FORBIDDEN_ITEM_TYPES = Object.freeze([
  'commandExecution',
  'fileChange',
  'mcpToolCall',
  'dynamicToolCall',
  'webSearch',
  'imageView',
  'collabToolCall',
] as const);

export type JsonRpcId = number | string;

/** Strict wire ID equality — numeric `1` and string `"1"` are distinct. */
export const jsonRpcIdsEqual = (left: JsonRpcId, right: JsonRpcId): boolean => left === right;

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

/** Server-initiated JSON-RPC request (approvals / tools) — rejected by Neo probe. */
export type JsonRpcServerRequest = {
  readonly method: string;
  readonly id: JsonRpcId;
  readonly params?: unknown;
};

export type ParsedFrame =
  | { readonly kind: 'success'; readonly value: JsonRpcSuccess }
  | { readonly kind: 'failure'; readonly value: JsonRpcFailure }
  | { readonly kind: 'notification'; readonly value: JsonRpcServerNotification }
  | { readonly kind: 'server-request'; readonly value: JsonRpcServerRequest }
  | { readonly kind: 'malformed'; readonly raw: string; readonly reason: string };

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
  if (trimmed.length === 0) return { kind: 'malformed', raw, reason: 'empty' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { kind: 'malformed', raw, reason: 'non-json' };
  }
  if (!isPlainObject(parsed)) return { kind: 'malformed', raw, reason: 'non-object' };

  const hasResult = 'result' in parsed;
  const hasError = 'error' in parsed;
  const hasMethod = typeof parsed.method === 'string';
  const hasId = 'id' in parsed;

  if (hasResult && hasError) return { kind: 'malformed', raw, reason: 'result-and-error' };

  if (hasId && hasResult && !hasMethod)
    return {
      kind: 'success',
      value: { id: parsed.id as JsonRpcId, result: parsed.result },
    };

  if (hasId && hasError && !hasMethod) {
    let errorValue: JsonRpcFailure['error'] = { message: 'unknown' };
    if (isPlainObject(parsed.error)) {
      errorValue = {
        ...(typeof parsed.error.code === 'number' ? { code: parsed.error.code } : {}),
        ...(typeof parsed.error.message === 'string' ? { message: parsed.error.message } : {}),
      };
    }
    return {
      kind: 'failure',
      value: { id: parsed.id as JsonRpcId, error: errorValue },
    };
  }

  if (hasMethod && hasId) {
    const method = parsed.method;
    if (typeof method !== 'string') return { kind: 'malformed', raw, reason: 'method-not-string' };
    return {
      kind: 'server-request',
      value: {
        method,
        id: parsed.id as JsonRpcId,
        params: parsed.params,
      },
    };
  }

  if (hasMethod && !hasId) {
    const method = parsed.method;
    if (typeof method !== 'string') return { kind: 'malformed', raw, reason: 'method-not-string' };
    return {
      kind: 'notification',
      value: { method, params: parsed.params },
    };
  }

  return { kind: 'malformed', raw, reason: 'unclassified' };
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

export const isForbiddenNotificationMethod = (method: string): boolean => {
  if ((FORBIDDEN_POST_DISPATCH_EVENTS as readonly string[]).includes(method)) return true;
  if (method.startsWith('mcp') || method.includes('mcpServer')) return true;
  if (/shell|commandExecution|fileChange|webSearch|web_browser|browsing/i.test(method)) return true;
  return false;
};

export const isAllowedServerNotification = (method: string): boolean =>
  (ALLOWED_SERVER_NOTIFICATION_METHODS as readonly string[]).includes(method);

export const isAllowedItemType = (type: unknown): type is (typeof ALLOWED_ITEM_TYPES)[number] =>
  typeof type === 'string' && (ALLOWED_ITEM_TYPES as readonly string[]).includes(type);

export const isForbiddenItemType = (type: unknown): boolean =>
  typeof type === 'string' && (FORBIDDEN_ITEM_TYPES as readonly string[]).includes(type);

/** Decode official account/read → result.account.type */
export type AccountDecode =
  | { readonly kind: 'null' }
  | { readonly kind: 'chatgpt'; readonly account: Record<string, unknown> }
  | { readonly kind: 'non-chatgpt'; readonly type: string }
  | { readonly kind: 'malformed'; readonly reason: string };

export const decodeAccountReadResult = (result: unknown): AccountDecode => {
  if (!isPlainObject(result)) return { kind: 'malformed', reason: 'account-result-not-object' };
  if (!('account' in result)) return { kind: 'malformed', reason: 'account-field-missing' };
  if (result.account === null) return { kind: 'null' };
  if (!isPlainObject(result.account)) return { kind: 'malformed', reason: 'account-not-object' };
  const type = result.account.type;
  if (typeof type !== 'string' || type.length === 0)
    return { kind: 'malformed', reason: 'account-type-missing' };
  if (type === 'chatgpt') return { kind: 'chatgpt', account: result.account };
  return { kind: 'non-chatgpt', type };
};

export type ConfigDecode =
  | { readonly kind: 'ok'; readonly config: Record<string, unknown> }
  | { readonly kind: 'malformed'; readonly reason: string };

export const decodeConfigReadResult = (result: unknown): ConfigDecode => {
  if (!isPlainObject(result)) return { kind: 'malformed', reason: 'config-result-not-object' };
  if (!('config' in result)) return { kind: 'malformed', reason: 'config-field-missing' };
  if (!isPlainObject(result.config)) return { kind: 'malformed', reason: 'config-not-object' };
  return { kind: 'ok', config: result.config };
};

export type RequirementsDecode =
  | { readonly kind: 'ok'; readonly requirements: Record<string, unknown> | null }
  | { readonly kind: 'malformed'; readonly reason: string };

export const decodeConfigRequirementsResult = (result: unknown): RequirementsDecode => {
  if (!isPlainObject(result))
    return { kind: 'malformed', reason: 'requirements-result-not-object' };
  if (!('requirements' in result))
    return { kind: 'malformed', reason: 'requirements-field-missing' };
  if (result.requirements === null) return { kind: 'ok', requirements: null };
  if (!isPlainObject(result.requirements))
    return { kind: 'malformed', reason: 'requirements-not-object' };
  return { kind: 'ok', requirements: result.requirements };
};

export type RateLimitsDecode =
  | { readonly kind: 'ok'; readonly exhausted: boolean }
  | { readonly kind: 'malformed'; readonly reason: string };

const bucketReached = (bucket: unknown): boolean | null => {
  if (!isPlainObject(bucket)) return null;
  if (!('rateLimitReachedType' in bucket)) return null;
  return bucket.rateLimitReachedType !== null && bucket.rateLimitReachedType !== undefined;
};

export const decodeRateLimitsReadResult = (result: unknown): RateLimitsDecode => {
  if (!isPlainObject(result)) return { kind: 'malformed', reason: 'rateLimits-result-not-object' };
  if (!('rateLimits' in result)) return { kind: 'malformed', reason: 'rateLimits-field-missing' };
  const primaryReached = bucketReached(result.rateLimits);
  if (primaryReached === null) return { kind: 'malformed', reason: 'rateLimits-shape-invalid' };

  let exhausted = primaryReached;
  if ('rateLimitsByLimitId' in result && result.rateLimitsByLimitId !== undefined) {
    if (!isPlainObject(result.rateLimitsByLimitId))
      return { kind: 'malformed', reason: 'rateLimitsByLimitId-not-object' };
    for (const value of Object.values(result.rateLimitsByLimitId)) {
      const reached = bucketReached(value);
      if (reached === null)
        return { kind: 'malformed', reason: 'rateLimitsByLimitId-bucket-invalid' };
      if (reached) exhausted = true;
    }
  }
  return { kind: 'ok', exhausted };
};

export type ModelDecode =
  | { readonly kind: 'ok'; readonly modelId: string }
  | { readonly kind: 'empty' }
  | { readonly kind: 'multiple' }
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'malformed'; readonly reason: string };

export const decodeModelListResult = (result: unknown): ModelDecode => {
  if (!isPlainObject(result)) return { kind: 'malformed', reason: 'model-list-not-object' };
  if (!Array.isArray(result.data)) return { kind: 'malformed', reason: 'model-data-missing' };
  const visibleDefaults: string[] = [];
  let sawTextCapableNonDefault = false;
  for (const entry of result.data) {
    if (!isPlainObject(entry)) return { kind: 'malformed', reason: 'model-entry-not-object' };
    if (entry.hidden === true) continue;
    if (typeof entry.id !== 'string' || entry.id.length === 0)
      return { kind: 'malformed', reason: 'model-id-missing' };
    if (!Array.isArray(entry.inputModalities))
      return { kind: 'malformed', reason: 'inputModalities-missing' };
    const hasText = entry.inputModalities.includes('text');
    if (entry.isDefault === true) {
      if (!hasText) return { kind: 'unsupported' };
      visibleDefaults.push(entry.id);
    } else if (hasText) {
      sawTextCapableNonDefault = true;
    }
  }
  if (visibleDefaults.length === 0) {
    if (result.data.length === 0) return { kind: 'empty' };
    if (sawTextCapableNonDefault) return { kind: 'empty' };
    return { kind: 'unsupported' };
  }
  if (visibleDefaults.length > 1) return { kind: 'multiple' };
  const only = visibleDefaults[0];
  if (only === undefined) return { kind: 'empty' };
  return { kind: 'ok', modelId: only };
};

export type ConfigPreflightDecode =
  | { readonly kind: 'ok' }
  | { readonly kind: 'policy-rejected'; readonly reason: string }
  | { readonly kind: 'malformed'; readonly reason: string };

const isDisabledFlag = (value: unknown): boolean => value === false;

const isEmptyObject = (value: unknown): boolean =>
  isPlainObject(value) && Object.keys(value).length === 0;

const appsAllDisabledOrEmpty = (apps: unknown): boolean => {
  if (apps === undefined || apps === null) return true;
  if (!isPlainObject(apps)) return false;
  const entries = Object.entries(apps);
  if (entries.length === 0) return true;
  for (const [, value] of entries) {
    if (!isPlainObject(value)) return false;
    if (value.enabled !== false) return false;
  }
  return true;
};

const mcpEmpty = (value: unknown): boolean => {
  if (value === undefined || value === null) return true;
  if (!isPlainObject(value)) return false;
  return Object.keys(value).length === 0;
};

const hooksDisabled = (value: unknown): boolean => {
  if (value === undefined || value === null || value === false) return true;
  if (isEmptyObject(value)) return true;
  return false;
};

const toolsWebSearchDisabled = (tools: unknown): boolean => {
  if (tools === undefined || tools === null) return true;
  if (!isPlainObject(tools)) return false;
  // Non-null web_search tool config means the tool surface is present → reject.
  if (!('web_search' in tools)) return Object.keys(tools).length === 0;
  return tools.web_search === null;
};

const featuresSafe = (features: unknown): boolean => {
  if (features === undefined || features === null) return true;
  if (!isPlainObject(features)) return false;
  for (const name of FORBIDDEN_ENABLED_FEATURES) {
    if (features[name] === true) return false;
  }
  return true;
};

const forbiddenConfigFlagsOff = (config: Record<string, unknown>): boolean => {
  for (const key of FORBIDDEN_ENABLED_CONFIG_FLAGS) {
    if (config[key] === true) return false;
  }
  return true;
};

/**
 * Null / absent / empty base URL keys are safe. Reject only actual non-default overrides
 * (non-empty string). Do not reject merely because the key name appears in JSON.
 */
const baseUrlOverridesSafe = (config: Record<string, unknown>): boolean => {
  for (const key of BASE_URL_CONFIG_KEYS) {
    if (!(key in config)) continue;
    const value = config[key];
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && value.trim().length === 0) continue;
    if (typeof value === 'string') return false;
    return false;
  }
  // Nested model_providers.*.base_url custom overrides.
  if (isPlainObject(config.model_providers)) {
    for (const provider of Object.values(config.model_providers)) {
      if (!isPlainObject(provider)) continue;
      for (const key of ['base_url', 'baseUrl', 'openai_base_url', 'chatgpt_base_url'] as const) {
        const value = provider[key];
        if (value === null || value === undefined) continue;
        if (typeof value === 'string' && value.trim().length === 0) continue;
        // Any non-empty string or non-string override is a custom base URL.
        return false;
      }
    }
  }
  return true;
};

const probePermissionsProfileOk = (config: Record<string, unknown>): boolean => {
  if (config.default_permissions !== PROBE_PERMISSIONS_PROFILE_ID) return false;
  if (!isPlainObject(config.permissions)) return false;
  const profile = config.permissions[PROBE_PERMISSIONS_PROFILE_ID];
  if (!isPlainObject(profile)) return false;
  if (!isPlainObject(profile.filesystem)) return false;
  if (profile.filesystem[':root'] === 'read' || profile.filesystem[':root'] === 'write')
    return false;
  if (profile.filesystem[':minimal'] !== 'read') return false;
  const workspace = profile.filesystem[':workspace_roots'];
  if (!isPlainObject(workspace)) return false;
  if (workspace['.'] !== 'read') return false;
  if (!isPlainObject(profile.network) || profile.network.enabled !== false) return false;
  return true;
};

const requireExact = (
  config: Record<string, unknown>,
  key: string,
  expected: unknown,
): ConfigPreflightDecode | null => {
  if (!(key in config) || config[key] !== expected) return { kind: 'policy-rejected', reason: key };
  return null;
};

/**
 * Fail-closed preflight for Codex 0.147.0 effective config/requirements.
 * Does not require a total key allowlist: unknown keys are ignored unless
 * security-critical fields are missing, null, or unsafe. Null is never treated
 * as a safe default for approval / web_search / login shell.
 *
 * Legacy `sandbox_mode` (including `read-only`) implies full filesystem read on
 * Windows and cannot express probeCwd-only roots via SandboxPolicy — probe requires
 * the permissions profile instead (`sandbox_mode` must be null/absent).
 */
export const decodeConfigPreflight = (
  config: Record<string, unknown>,
  requirements: Record<string, unknown> | null,
): ConfigPreflightDecode => {
  const criticalChecks: Array<ConfigPreflightDecode | null> = [
    requireExact(config, 'cli_auth_credentials_store', CLI_AUTH_CREDENTIALS_STORE),
    requireExact(config, 'forced_login_method', FORCED_LOGIN_METHOD),
    requireExact(config, 'model_provider', APPROVED_MODEL_PROVIDER),
    requireExact(config, 'approval_policy', APPROVED_APPROVAL_POLICY),
    requireExact(config, 'web_search', APPROVED_WEB_SEARCH_MODE),
    requireExact(config, 'allow_login_shell', false),
  ];
  for (const check of criticalChecks) {
    if (check !== null) return check;
  }

  // Legacy sandbox_mode enables full-FS-read semantics on Windows and disables permissions.
  if ('sandbox_mode' in config && config.sandbox_mode !== null && config.sandbox_mode !== undefined)
    return { kind: 'policy-rejected', reason: 'legacy-sandbox-full-filesystem-read' };
  if ('sandbox' in config && config.sandbox !== null && config.sandbox !== undefined)
    return { kind: 'policy-rejected', reason: 'legacy-sandbox-full-filesystem-read' };

  if (!probePermissionsProfileOk(config))
    return { kind: 'policy-rejected', reason: 'probe-permissions-profile' };

  // Legacy aliases — if present they must also be explicitly safe (null/true rejected).
  if ('web' in config && !isDisabledFlag(config.web))
    return { kind: 'policy-rejected', reason: 'web' };
  if ('shell' in config && !isDisabledFlag(config.shell))
    return { kind: 'policy-rejected', reason: 'shell' };
  if ('search' in config && !isDisabledFlag(config.search))
    return { kind: 'policy-rejected', reason: 'search' };

  if (!toolsWebSearchDisabled(config.tools)) return { kind: 'policy-rejected', reason: 'tools' };
  if (!appsAllDisabledOrEmpty(config.apps)) return { kind: 'policy-rejected', reason: 'apps' };
  if (!mcpEmpty(config.mcp_servers) || !mcpEmpty(config.mcpServers))
    return { kind: 'policy-rejected', reason: 'mcp' };
  if (!hooksDisabled(config.hooks)) return { kind: 'policy-rejected', reason: 'hooks' };
  if (!featuresSafe(config.features)) return { kind: 'policy-rejected', reason: 'features' };
  if (!forbiddenConfigFlagsOff(config))
    return { kind: 'policy-rejected', reason: 'experimental_use_unified_exec_tool' };
  if (!baseUrlOverridesSafe(config))
    return { kind: 'policy-rejected', reason: 'base-url-override' };

  const serialized = JSON.stringify({ config, requirements }).toLowerCase();
  if (serialized.includes('customprovider') || serialized.includes('custom_provider'))
    return { kind: 'policy-rejected', reason: 'custom-provider' };
  if (serialized.includes('openai_api_key') || serialized.includes('codex_api_key'))
    return { kind: 'policy-rejected', reason: 'api-key' };

  if (requirements !== null) {
    if (isPlainObject(requirements.network) && requirements.network.enabled === true)
      return { kind: 'policy-rejected', reason: 'network' };
    if (requirements.allowLoginShell === true)
      return { kind: 'policy-rejected', reason: 'allowLoginShell' };
    if (requirements.allowRemoteControl === true)
      return { kind: 'policy-rejected', reason: 'allowRemoteControl' };
    if (
      isPlainObject(requirements.featureRequirements) &&
      requirements.featureRequirements.unified_exec === true
    )
      return { kind: 'policy-rejected', reason: 'unified_exec' };
    if (
      isPlainObject(requirements.browserUse) &&
      (requirements.browserUse.enabled === true || requirements.browserUse.allowed === true)
    )
      return { kind: 'policy-rejected', reason: 'browserUse' };
    if (
      isPlainObject(requirements.computerUse) &&
      (requirements.computerUse.enabled === true || requirements.computerUse.allowed === true)
    )
      return { kind: 'policy-rejected', reason: 'computerUse' };
    if (
      Array.isArray(requirements.allowedWebSearchModes) &&
      requirements.allowedWebSearchModes.some((mode) => mode !== APPROVED_WEB_SEARCH_MODE)
    )
      return { kind: 'policy-rejected', reason: 'allowedWebSearchModes' };
  }
  return { kind: 'ok' };
};

/** @deprecated Use decodeConfigPreflight — retained name for call-site clarity in reviews. */
export const hasEffectiveConfigViolation = (
  config: Record<string, unknown>,
  requirements: Record<string, unknown> | null,
): boolean => decodeConfigPreflight(config, requirements).kind !== 'ok';

export const extractThreadId = (result: unknown): string | null => {
  if (!isPlainObject(result)) return null;
  const thread = result.thread;
  if (!isPlainObject(thread)) return null;
  return typeof thread.id === 'string' && thread.id.length > 0 ? thread.id : null;
};

export const extractThreadModelProvider = (result: unknown): string | null => {
  if (!isPlainObject(result)) return null;
  const thread = result.thread;
  if (!isPlainObject(thread)) return null;
  return typeof thread.modelProvider === 'string' ? thread.modelProvider : null;
};

export const extractTurnId = (result: unknown): string | null => {
  if (!isPlainObject(result)) return null;
  const turn = result.turn;
  if (!isPlainObject(turn)) return null;
  return typeof turn.id === 'string' && turn.id.length > 0 ? turn.id : null;
};

export type TurnCompletedDecode =
  | { readonly kind: 'completed'; readonly turnId: string; readonly threadId: string }
  | { readonly kind: 'failed-or-interrupted'; readonly status: string }
  | { readonly kind: 'malformed'; readonly reason: string };

export const decodeTurnCompletedParams = (params: unknown): TurnCompletedDecode => {
  if (!isPlainObject(params)) return { kind: 'malformed', reason: 'turn-completed-params' };
  if (!isPlainObject(params.turn)) return { kind: 'malformed', reason: 'turn-missing' };
  const turnId = typeof params.turn.id === 'string' ? params.turn.id : '';
  if (turnId.length === 0) return { kind: 'malformed', reason: 'turn-id-missing' };
  const status = params.turn.status;
  if (status !== 'completed' && status !== 'failed' && status !== 'interrupted')
    return { kind: 'malformed', reason: 'turn-status-unknown' };
  if (status !== 'completed') return { kind: 'failed-or-interrupted', status };
  const threadId =
    typeof params.threadId === 'string'
      ? params.threadId
      : typeof params.turn.threadId === 'string'
        ? params.turn.threadId
        : null;
  if (threadId === null || threadId.length === 0)
    return { kind: 'malformed', reason: 'thread-id-missing' };
  return { kind: 'completed', turnId, threadId };
};

export const extractAgentMessageText = (params: unknown): string | null => {
  if (!isPlainObject(params)) return null;
  if (!isPlainObject(params.item)) return null;
  if (params.item.type !== 'agentMessage') return null;
  return typeof params.item.text === 'string' ? params.item.text : null;
};

export const extractItemType = (params: unknown): string | null => {
  if (!isPlainObject(params)) return null;
  if (!isPlainObject(params.item)) return null;
  return typeof params.item.type === 'string' ? params.item.type : null;
};

/**
 * Legacy SandboxPolicy shape — network denied. Does NOT provide probeCwd-only reads;
 * prefer {@link buildProbeTurnPermissionsParams}. Retained for schema token tests.
 */
export const buildProbeSandboxPolicy = (): Record<string, unknown> => ({
  type: APPROVED_SANDBOX_POLICY_TYPE,
  networkAccess: false,
});

/** Permissions-based thread/start fields: probeCwd-only via runtimeWorkspaceRoots + profile. */
export const buildProbeThreadIsolationParams = (probeCwd: string): Record<string, unknown> => ({
  permissions: PROBE_PERMISSIONS_PROFILE_ID,
  cwd: probeCwd,
  runtimeWorkspaceRoots: [probeCwd],
});

/** Permissions-based turn/start isolation (cannot combine with sandboxPolicy). */
export const buildProbeTurnPermissionsParams = (): Record<string, unknown> => ({
  permissions: PROBE_PERMISSIONS_PROFILE_ID,
});

/** Initialize params with remoteControl status notification opted out. */
export const buildProbeInitializeParams = (): Record<string, unknown> => ({
  clientInfo: {
    name: 'neo-codex-probe',
    title: 'Neo Codex Probe',
    version: '3.7E1',
  },
  capabilities: {
    experimentalApi: false,
    requestAttestation: false,
    optOutNotificationMethods: [...OPT_OUT_NOTIFICATION_METHODS],
  },
});
