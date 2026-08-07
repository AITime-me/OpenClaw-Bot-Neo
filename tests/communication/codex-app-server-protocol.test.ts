import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APPROVED_MODEL_PROVIDER,
  APPROVED_SANDBOX_MODE,
  APPROVED_WEB_SEARCH_MODE,
  FIXED_PROBE_PROMPT,
  OPT_OUT_NOTIFICATION_METHODS,
  buildProbeInitializeParams,
  buildProbeSandboxPolicy,
  decodeAccountReadResult,
  decodeConfigPreflight,
  decodeConfigReadResult,
  decodeModelListResult,
  decodeRateLimitsReadResult,
  isExactOkTrueOutput,
  jsonRpcIdsEqual,
  parseJsonlFrame,
  serializeRequest,
} from '../../src/communication/adapters/codex-app-server/codex-app-server-protocol.js';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/codex-app-server', name), 'utf8'));

describe('codex-app-server protocol', () => {
  it('keeps fixed prompt and exact ok:true output', () => {
    expect(FIXED_PROBE_PROMPT).toBe('Return one JSON object with ok=true and no other fields.');
    expect(isExactOkTrueOutput('{ "ok": true }')).toBe(true);
    expect(isExactOkTrueOutput('{"ok":true}')).toBe(true);
    expect(isExactOkTrueOutput('{"ok":false}')).toBe(false);
    expect(isExactOkTrueOutput('{"ok":true,"x":1}')).toBe(false);
  });

  it('parses success/failure/notification/server-request and rejects result+error', () => {
    expect(parseJsonlFrame('{"id":1,"result":{}}').kind).toBe('success');
    expect(parseJsonlFrame('{"id":1,"error":{"message":"x"}}').kind).toBe('failure');
    expect(parseJsonlFrame('{"method":"turn/completed","params":{}}').kind).toBe('notification');
    expect(
      parseJsonlFrame('{"method":"item/commandExecution/requestApproval","id":"s"}').kind,
    ).toBe('server-request');
    const both = parseJsonlFrame('{"id":1,"result":{},"error":{"message":"x"}}');
    expect(both.kind).toBe('malformed');
    expect(parseJsonlFrame('not-json').kind).toBe('malformed');
  });

  it('distinguishes numeric and string response ids', () => {
    expect(jsonRpcIdsEqual(1, 1)).toBe(true);
    expect(jsonRpcIdsEqual('1', '1')).toBe(true);
    expect(jsonRpcIdsEqual(1, '1')).toBe(false);
  });

  it('decodes official nested account/config/quota/model shapes', () => {
    expect(decodeAccountReadResult({ account: null, requiresOpenaiAuth: true })).toEqual({
      kind: 'null',
    });
    expect(
      decodeAccountReadResult({ account: { type: 'chatgpt' }, requiresOpenaiAuth: true }).kind,
    ).toBe('chatgpt');
    expect(
      decodeAccountReadResult({ account: { type: 'apiKey' }, requiresOpenaiAuth: true }).kind,
    ).toBe('non-chatgpt');
    expect(decodeAccountReadResult({ type: 'chatgpt' }).kind).toBe('malformed');

    expect(decodeConfigReadResult({ config: { web_search: 'disabled' } }).kind).toBe('ok');
    expect(decodeConfigReadResult({ web_search: 'disabled' }).kind).toBe('malformed');

    expect(
      decodeRateLimitsReadResult({
        rateLimits: { rateLimitReachedType: null, primary: {} },
      }).kind,
    ).toBe('ok');
    expect(
      decodeRateLimitsReadResult({
        rateLimits: { rateLimitReachedType: 'primary', primary: {} },
      }),
    ).toEqual({ kind: 'ok', exhausted: true });
    expect(decodeRateLimitsReadResult({ remaining: 0 }).kind).toBe('malformed');

    expect(
      decodeModelListResult({
        data: [{ id: 'm', isDefault: true, hidden: false, inputModalities: ['text'] }],
        nextCursor: null,
      }),
    ).toEqual({ kind: 'ok', modelId: 'm' });
    expect(decodeModelListResult({ models: [{ id: 'm', textCapable: true }] }).kind).toBe(
      'malformed',
    );
  });

  it('checks Codex 0.147.0 security-critical config values without total key allowlist', () => {
    const okConfig = {
      cli_auth_credentials_store: 'file',
      forced_login_method: 'chatgpt',
      model_provider: APPROVED_MODEL_PROVIDER,
      model: 'gpt-probe',
      approval_policy: 'never',
      sandbox_mode: APPROVED_SANDBOX_MODE,
      web_search: APPROVED_WEB_SEARCH_MODE,
      allow_login_shell: false,
      tools: { web_search: null },
      apps: {},
      mcp_servers: {},
      hooks: {},
      features: { mentions_v2: true, remote_plugin: false },
      model_context_window: 128000,
    };
    expect(decodeConfigPreflight(okConfig, null).kind).toBe('ok');
    expect(decodeConfigPreflight({ ...okConfig, approval_policy: null }, null).kind).toBe(
      'policy-rejected',
    );
    expect(decodeConfigPreflight({ ...okConfig, sandbox_mode: null }, null).kind).toBe(
      'policy-rejected',
    );
    expect(decodeConfigPreflight({ ...okConfig, web_search: null }, null).kind).toBe(
      'policy-rejected',
    );
    expect(decodeConfigPreflight({ ...okConfig, allow_login_shell: true }, null).kind).toBe(
      'policy-rejected',
    );
    expect(
      decodeConfigPreflight({ ...okConfig, cli_auth_credentials_store: 'keyring' }, null).kind,
    ).toBe('policy-rejected');
    expect(decodeConfigPreflight({ ...okConfig, forced_login_method: 'api' }, null).kind).toBe(
      'policy-rejected',
    );
    expect(decodeConfigPreflight({ ...okConfig, model_provider: 'azure' }, null).kind).toBe(
      'policy-rejected',
    );
    expect(decodeConfigPreflight({ ...okConfig, approval_policy: 'on-request' }, null).kind).toBe(
      'policy-rejected',
    );
    expect(decodeConfigPreflight({ ...okConfig, web_search: 'live' }, null).kind).toBe(
      'policy-rejected',
    );
    expect(
      decodeConfigPreflight(
        { ...okConfig, features: { ...okConfig.features, remote_plugin: true } },
        null,
      ).kind,
    ).toBe('policy-rejected');
    expect(
      decodeConfigPreflight(okConfig, {
        network: { enabled: true },
      }).kind,
    ).toBe('policy-rejected');
    expect(
      decodeConfigPreflight(okConfig, {
        featureRequirements: { unified_exec: true },
      }).kind,
    ).toBe('policy-rejected');
  });

  it('rejects observed 0.147.0 live config/read and parses remoteControl notification fixture', () => {
    const observed = fixture('codex-0.147.0-observed-config-read.json') as {
      config: Record<string, unknown>;
    };
    expect(decodeConfigPreflight(observed.config, null).kind).toBe('policy-rejected');

    const compliant = fixture('codex-0.147.0-compliant-config-read.json') as {
      config: Record<string, unknown>;
    };
    expect(decodeConfigPreflight(compliant.config, null).kind).toBe('ok');

    const remote = fixture('codex-0.147.0-remote-control-status-changed.json') as {
      method: string;
    };
    expect(remote.method).toBe('remoteControl/status/changed');
    expect(parseJsonlFrame(JSON.stringify(remote)).kind).toBe('notification');
    expect(OPT_OUT_NOTIFICATION_METHODS).toContain('remoteControl/status/changed');
  });

  it('builds 0.147.0 initialize opt-out and readOnly sandbox policy', () => {
    expect(buildProbeInitializeParams()).toEqual({
      clientInfo: {
        name: 'neo-codex-probe',
        title: 'Neo Codex Probe',
        version: '3.7E1',
      },
      capabilities: {
        experimentalApi: false,
        requestAttestation: false,
        optOutNotificationMethods: ['remoteControl/status/changed'],
      },
    });
    expect(buildProbeSandboxPolicy()).toEqual({ type: 'readOnly', networkAccess: false });
  });

  it('serializes requests without jsonrpc header', () => {
    expect(serializeRequest({ method: 'initialize', id: 1 })).toBe(
      '{"method":"initialize","id":1}',
    );
  });
});
