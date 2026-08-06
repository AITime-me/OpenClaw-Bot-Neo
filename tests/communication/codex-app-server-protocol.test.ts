import { describe, expect, it } from 'vitest';
import {
  FIXED_PROBE_PROMPT,
  isExactOkTrueOutput,
  parseJsonlFrame,
  serializeRequest,
} from '../../src/communication/adapters/codex-app-server/codex-app-server-protocol.js';

describe('codex-app-server protocol', () => {
  it('keeps fixed probe prompt and exact ok:true schema', () => {
    expect(FIXED_PROBE_PROMPT).toBe('Return one JSON object with ok=true and no other fields.');
    expect(isExactOkTrueOutput('{"ok":true}')).toBe(true);
    expect(isExactOkTrueOutput('{"ok": false}')).toBe(false);
    expect(isExactOkTrueOutput('{"ok":true,"x":1}')).toBe(false);
  });

  it('parses success/failure/notification and rejects malformed', () => {
    expect(parseJsonlFrame('{"id":1,"result":{}}').kind).toBe('success');
    expect(parseJsonlFrame('{"id":1,"error":{"message":"x"}}').kind).toBe('failure');
    expect(parseJsonlFrame('{"method":"turn/completed","params":{}}').kind).toBe('notification');
    expect(parseJsonlFrame('not-json').kind).toBe('malformed');
  });

  it('serializes requests without logging bodies elsewhere', () => {
    expect(serializeRequest({ method: 'initialize', id: 1, params: {} })).toContain(
      '"method":"initialize"',
    );
  });
});
