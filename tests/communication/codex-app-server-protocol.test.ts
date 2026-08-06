import { describe, expect, it } from 'vitest';
import {
  APPROVED_MODEL_PROVIDER,
  FIXED_PROBE_PROMPT,
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

    expect(decodeConfigReadResult({ config: { web: false } }).kind).toBe('ok');
    expect(decodeConfigReadResult({ web: false }).kind).toBe('malformed');

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

  it('requires full config allowlist and approved provider', () => {
    const okConfig = {
      cli_auth_credentials_store: 'file',
      forced_login_method: 'chatgpt',
      model_provider: APPROVED_MODEL_PROVIDER,
      model: 'gpt-probe',
      approval_policy: 'never',
      sandbox: 'readOnly',
      web: false,
      shell: false,
      hooks: false,
      search: false,
      apps: { _default: { enabled: false } },
      mcpServers: {},
    };
    expect(decodeConfigPreflight(okConfig, null).kind).toBe('ok');
    expect(
      decodeConfigPreflight({ ...okConfig, experimentalAgenticSurface: true }, null).kind,
    ).toBe('policy-rejected');
    expect(
      decodeConfigPreflight({ ...okConfig, cli_auth_credentials_store: 'keyring' }, null).kind,
    ).toBe('policy-rejected');
    expect(decodeConfigPreflight({ ...okConfig, model_provider: 'azure' }, null).kind).toBe(
      'policy-rejected',
    );
  });

  it('serializes requests without jsonrpc header', () => {
    expect(serializeRequest({ method: 'initialize', id: 1 })).toBe(
      '{"method":"initialize","id":1}',
    );
  });
});
