import { describe, expect, it } from 'vitest';
import { err } from '../src/core/domain/index.js';
import {
  MAX_METADATA_NODES,
  MAX_METADATA_TOTAL_KEY_LENGTH,
  MAX_SCAN_INPUT_LENGTH,
  maskSecrets,
  scanSensitiveData,
  scanSensitiveMetadata,
  scanWithFailClosed,
} from '../src/core/policy/index.js';
import {
  BEARER_HEADER,
  BEARER_VALUE,
  CONNECTION_STRING,
  COOKIE_LINE,
  COOKIE_VALUE,
  PEM_BLOCK,
  QUOTED_API_KEY_LINE,
  QUOTED_API_KEY_VALUE,
  QUOTED_PASSWORD_LINE,
  QUOTED_PASSWORD_VALUE,
  SINGLE_QUOTED_LINE,
  SINGLE_QUOTED_VALUE,
  TELEGRAM_BOT_TOKEN,
  UNQUOTED_PASSWORD_LINE,
  UNQUOTED_PASSWORD_VALUE,
  UNTERMINATED_PEM,
  URL_WITH_CREDENTIALS,
  URL_WITH_ENCODED_CREDENTIALS,
} from './support/synthetic-secrets.js';

const redact = (input: string): string => {
  const result = scanSensitiveData(input);
  expect(result.ok).toBe(true);
  return result.ok ? result.value.redacted : '';
};

describe('assignment values are redacted in full', () => {
  it.each([
    ['double-quoted password with spaces', QUOTED_PASSWORD_LINE, QUOTED_PASSWORD_VALUE],
    ['double-quoted api key', QUOTED_API_KEY_LINE, QUOTED_API_KEY_VALUE],
    ['single-quoted client secret', SINGLE_QUOTED_LINE, SINGLE_QUOTED_VALUE],
    ['unquoted value with spaces', UNQUOTED_PASSWORD_LINE, UNQUOTED_PASSWORD_VALUE],
    ['cookie header', COOKIE_LINE, COOKIE_VALUE],
  ])('covers the whole %s', (_label, input, secret) => {
    const redacted = redact(input);
    for (const fragment of secret.split(/\s+/)) expect(redacted).not.toContain(fragment);
    expect(redacted).toContain('[REDACTED#');
  });

  it('handles several assignments and line breaks in one input', () => {
    const input = [QUOTED_PASSWORD_LINE, 'note = keep this', SINGLE_QUOTED_LINE].join('\n');
    const redacted = redact(input);
    expect(redacted).toContain('note = keep this');
    expect(redacted).not.toContain(QUOTED_PASSWORD_VALUE);
    expect(redacted).not.toContain(SINGLE_QUOTED_VALUE);
  });

  it('keeps a trailing separator outside a quoted value', () => {
    const redacted = redact(`{"password": "${QUOTED_PASSWORD_VALUE}", "keep": 1}`);
    expect(redacted).not.toContain('staple');
    expect(redacted).toContain('"keep": 1');
  });
});

describe('literal and URL detection', () => {
  it.each([
    ['telegram-bot-token', `Token ${TELEGRAM_BOT_TOKEN}`, TELEGRAM_BOT_TOKEN],
    ['bearer-token', BEARER_HEADER, BEARER_VALUE],
    ['url-credentials', `Use ${URL_WITH_CREDENTIALS}`, 'wonderland'],
    ['url-credentials', `Use ${URL_WITH_ENCODED_CREDENTIALS}`, 'w0nderland'],
    ['connection-string', CONNECTION_STRING, 'trustno1'],
    ['private-key', PEM_BLOCK, 'c3ludGhldGljLXBsYWNlaG9sZGVy'],
  ])('detects %s and removes the value', (category, input, secret) => {
    const result = scanSensitiveData(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.findings.some((finding) => finding.category === category)).toBe(true);
    expect(result.value.redacted).not.toContain(secret);
    expect(result.value.decision).toBe('deny');
  });

  it('redacts an unterminated private-key block to the end of the input', () => {
    const redacted = redact(UNTERMINATED_PEM);
    expect(redacted).not.toContain('dHJ1bmNhdGVkLXBsYWNlaG9sZGVy');
  });

  it('does not treat an ordinary URL as credentials', () => {
    const input = 'See https://example.com/team/@owner for details.';
    expect(redact(input)).toBe(input);
  });
});

describe('findings, ranges and idempotency', () => {
  it('never carries a fragment of the detected secret', () => {
    const result = scanSensitiveData(
      [QUOTED_PASSWORD_LINE, URL_WITH_CREDENTIALS, TELEGRAM_BOT_TOKEN].join('\n'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const serialized = JSON.stringify(result.value.findings);
    for (const fragment of ['staple', 'wonderland', 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcd1234'])
      expect(serialized).not.toContain(fragment);
    expect(result.value.findings.every((finding) => finding.end > finding.start)).toBe(true);
  });

  it('merges overlapping findings into one covering range', () => {
    const input = `password = "Bearer ${BEARER_VALUE}"`;
    const result = scanSensitiveData(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.findings).toHaveLength(1);
    expect(result.value.redacted).not.toContain(BEARER_VALUE);
  });

  it('masks idempotently and does not grow the marker', () => {
    for (const input of [
      QUOTED_PASSWORD_LINE,
      UNQUOTED_PASSWORD_LINE,
      URL_WITH_CREDENTIALS,
      TELEGRAM_BOT_TOKEN,
      COOKIE_LINE,
    ]) {
      const once = maskSecrets(input);
      const twice = maskSecrets(once);
      expect(twice).toBe(once);
      expect(maskSecrets(twice)).toBe(once);
    }
  });

  it('leaves ordinary safe text untouched', () => {
    const input = 'Подготовь безопасный отчёт по проекту и запланируй встречу.';
    expect(maskSecrets(input)).toBe(input);
    const result = scanSensitiveData(input);
    expect(result.ok && result.value.decision).toBe('allow');
  });

  it('handles empty input safely', () => {
    const result = scanSensitiveData('');
    expect(result).toEqual({ ok: true, value: { decision: 'allow', findings: [], redacted: '' } });
  });
});

describe('failure modes', () => {
  it('refuses an oversized input instead of scanning part of it', () => {
    const result = scanSensitiveData('a'.repeat(MAX_SCAN_INPUT_LENGTH + 1));
    expect(result).toEqual({
      ok: false,
      error: { code: 'INPUT_TOO_LARGE', reason: 'Scanner input exceeds the supported size.' },
    });
  });

  it('fails closed and never echoes the input', () => {
    const report = scanWithFailClosed(QUOTED_PASSWORD_LINE, () =>
      err({ code: 'SCANNER_FAILURE', reason: 'synthetic failure' }),
    );
    expect(report.decision).toBe('deny');
    expect(report.redacted).not.toContain('staple');
    expect(report.findings).toHaveLength(0);
  });

  it('reports oversized input through the fail-closed wrapper', () => {
    expect(scanWithFailClosed('a'.repeat(MAX_SCAN_INPUT_LENGTH + 1)).decision).toBe('deny');
  });
});

describe('newline after separator', () => {
  it.each([
    ['LF unquoted', `password =\n${UNQUOTED_PASSWORD_VALUE}`, UNQUOTED_PASSWORD_VALUE],
    ['CRLF unquoted', `password =\r\n${UNQUOTED_PASSWORD_VALUE}`, UNQUOTED_PASSWORD_VALUE],
    ['LF quoted', `password =\n"${QUOTED_PASSWORD_VALUE}"`, 'staple'],
    ['CRLF quoted', `password =\r\n"${QUOTED_PASSWORD_VALUE}"`, 'staple'],
    ['JSON-like LF', `"password":\n"${QUOTED_PASSWORD_VALUE}"`, 'staple'],
    ['JSON-like CRLF', `"password":\r\n"${QUOTED_PASSWORD_VALUE}"`, 'staple'],
    ['spaces around LF', `password = \t\n\t"${QUOTED_PASSWORD_VALUE}"`, 'staple'],
    ['single-quoted LF', `client_secret=\n'${SINGLE_QUOTED_VALUE}'`, 'quoted'],
  ])('covers %s assignment', (_label, input, fragment) => {
    const result = scanSensitiveData(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision).not.toBe('allow');
    expect(result.value.redacted).not.toContain(fragment);
    expect(JSON.stringify(result.value.findings)).not.toContain(fragment);
  });

  it('denies an empty value after separator instead of allowing', () => {
    const result = scanSensitiveData('password =');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision).toBe('deny');
  });

  it('denies multiple consecutive newlines after a separator', () => {
    const result = scanSensitiveData(`password =\n\n${UNQUOTED_PASSWORD_VALUE}`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision).toBe('deny');
  });
});

describe('metadata scanning', () => {
  it('denies a sensitive key by name without echoing the key or value', () => {
    const result = scanSensitiveMetadata({
      note: 'обычный текст',
      password: QUOTED_PASSWORD_VALUE,
      nested: { api_key: QUOTED_API_KEY_VALUE },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision).toBe('deny');
    const serialized = JSON.stringify(result.value);
    expect(serialized).not.toContain('staple');
    expect(serialized).not.toContain('QwErTyU');
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('api_key');
    expect(result.value.redactedEntries).toEqual({});
    expect(result.value.findings.every((finding) => finding.location === '[redacted-key]')).toBe(
      true,
    );
  });

  it('scans values that contain a secret even when the key looks harmless', () => {
    const result = scanSensitiveMetadata({ comment: `see ${URL_WITH_CREDENTIALS}` });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision).toBe('deny');
    expect(JSON.stringify(result.value.redactedEntries)).not.toContain('wonderland');
  });

  it('denies token-shaped metadata keys at every nesting level', () => {
    const tokenKey = TELEGRAM_BOT_TOKEN;
    const top = scanSensitiveMetadata({ [tokenKey]: 'x' });
    expect(top.ok && top.value.decision).toBe('deny');
    expect(JSON.stringify(top)).not.toContain(tokenKey);

    const nested = scanSensitiveMetadata({ wrapper: { [tokenKey]: 'x' } });
    expect(nested.ok && nested.value.decision).toBe('deny');
    expect(JSON.stringify(nested)).not.toContain(tokenKey);

    const inArray = scanSensitiveMetadata({ items: [{ [tokenKey]: 'x' }] });
    expect(inArray.ok && inArray.value.decision).toBe('deny');
    expect(JSON.stringify(inArray)).not.toContain(tokenKey);
  });

  it('denies control characters or newlines inside metadata keys', () => {
    const result = scanSensitiveMetadata({ 'safe\nname': 'value' });
    expect(result.ok && result.value.decision).toBe('deny');
    expect(JSON.stringify(result)).not.toContain('safe');
  });

  it('keeps safe metadata keys working', () => {
    const result = scanSensitiveMetadata({ origin: 'owner-note', comment: 'safe' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision).toBe('allow');
    expect(result.value.redactedEntries).toEqual({ origin: 'owner-note', comment: 'safe' });
  });

  it('is idempotent over already redacted safe metadata', () => {
    const first = scanSensitiveMetadata({ origin: '[REDACTED#password]' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = scanSensitiveMetadata(first.value.redactedEntries);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.redactedEntries).toEqual(first.value.redactedEntries);
  });

  it('refuses metadata that exceeds the depth limit', () => {
    const deep = { a: { b: { c: { d: { e: { f: 'too deep' } } } } } };
    expect(scanSensitiveMetadata(deep).ok).toBe(false);
  });

  it('accepts exactly 256 leaf properties and rejects the 257th', () => {
    const atLimit: Record<string, string> = {};
    for (let index = 0; index < MAX_METADATA_NODES; index += 1) atLimit[`k${String(index)}`] = 'ok';
    const allowed = scanSensitiveMetadata(atLimit);
    expect(allowed.ok).toBe(true);
    if (allowed.ok) expect(allowed.value.decision).toBe('allow');

    const over: Record<string, string> = { ...atLimit, over: 'x' };
    const denied = scanSensitiveMetadata(over);
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.error.code).toBe('METADATA_TOO_COMPLEX');
      expect(denied.error.reason).not.toContain('over');
      expect(JSON.stringify(denied.error)).not.toContain('k0');
    }
  });

  it('counts empty objects toward the node budget', () => {
    const atLimit: Record<string, object> = {};
    for (let index = 0; index < MAX_METADATA_NODES; index += 1) atLimit[`e${String(index)}`] = {};
    expect(scanSensitiveMetadata(atLimit).ok).toBe(true);
    const over: Record<string, object> = { ...atLimit, extra: {} };
    expect(scanSensitiveMetadata(over).ok).toBe(false);
    expect(
      scanSensitiveMetadata(
        Object.fromEntries(Array.from({ length: 1_000 }, (_, index) => [`e${String(index)}`, {}])),
      ).ok,
    ).toBe(false);
  });

  it('counts nested empty containers and array elements', () => {
    expect(scanSensitiveMetadata({ a: { b: {} } }).ok).toBe(true);
    const items = Array.from({ length: MAX_METADATA_NODES - 1 }, () => 'ok');
    expect(scanSensitiveMetadata({ items }).ok).toBe(true);
    expect(scanSensitiveMetadata({ items: [...items, 'x'] }).ok).toBe(false);
    expect(scanSensitiveMetadata({ items: Array.from({ length: 10 }, () => ({})) }).ok).toBe(true);
  });

  it('enforces total key length and rejects unsupported containers', () => {
    const longKey = 'k'.repeat(MAX_METADATA_TOTAL_KEY_LENGTH);
    expect(scanSensitiveMetadata({ [longKey]: 'ok' }).ok).toBe(true);
    expect(scanSensitiveMetadata({ [longKey + 'x']: 'ok' }).ok).toBe(false);
    expect(scanSensitiveMetadata({ when: new Date() }).ok).toBe(false);
    expect(scanSensitiveMetadata({ map: new Map() }).ok).toBe(false);
    expect(scanSensitiveMetadata({ set: new Set() }).ok).toBe(false);
    expect(scanSensitiveMetadata({ bytes: new Uint8Array([1]) }).ok).toBe(false);
    class Sample {
      value = 'x';
    }
    expect(scanSensitiveMetadata({ sample: new Sample() }).ok).toBe(false);
  });

  it('denies cyclic metadata and accessor properties without executing getters', () => {
    const cyclic: Record<string, unknown> = { a: 'ok' };
    cyclic.self = cyclic;
    const cyclicResult = scanSensitiveMetadata(cyclic);
    expect(cyclicResult.ok).toBe(false);
    if (!cyclicResult.ok) expect(JSON.stringify(cyclicResult.error)).not.toContain('self');

    let getterCalls = 0;
    const throwing = {};
    Object.defineProperty(throwing, 'secret', {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error('leak-me-now');
      },
    });
    const thrown = scanSensitiveMetadata(throwing);
    expect(thrown.ok).toBe(false);
    expect(getterCalls).toBe(0);
    if (!thrown.ok) {
      expect(thrown.error.reason).not.toContain('leak-me-now');
      expect(JSON.stringify(thrown.error)).not.toContain('secret');
    }

    let softCalls = 0;
    const soft = {};
    Object.defineProperty(soft, 'note', {
      enumerable: true,
      get() {
        softCalls += 1;
        return 'safe';
      },
    });
    expect(scanSensitiveMetadata(soft).ok).toBe(false);
    expect(softCalls).toBe(0);

    const withMethod = {
      note: 'safe',
      toJSON() {
        return { note: 'hijacked' };
      },
    };
    expect(scanSensitiveMetadata(withMethod).ok).toBe(false);

    const withValueOf = {
      note: 'safe',
      valueOf() {
        return 'hijacked';
      },
    };
    expect(scanSensitiveMetadata(withValueOf).ok).toBe(false);

    const customProto: Record<string, unknown> = Object.create({ inherited: 'x' }) as Record<
      string,
      unknown
    >;
    customProto.note = 'safe';
    expect(scanSensitiveMetadata(customProto).ok).toBe(false);

    const sparse = { items: [] as string[] };
    sparse.items[2] = 'x';
    expect(scanSensitiveMetadata(sparse).ok).toBe(false);

    const withSymbol = { note: 'safe', [Symbol('x')]: 'y' };
    expect(scanSensitiveMetadata(withSymbol).ok).toBe(false);

    expect(scanSensitiveMetadata({ when: /abc/ }).ok).toBe(false);
    expect(scanSensitiveMetadata({ origin: 'owner-note', nested: { comment: 'safe' } }).ok).toBe(
      true,
    );
  });
});

describe('token family detectors', () => {
  const join = (...parts: readonly string[]): string => parts.join('');
  const githubClassic = join('ghp_', 'AAAAAAAAAAAAAAAAAAAA');
  const githubFine = join('github_pat_', 'AAAAAAAAAAAAAAAAAAAA');
  const awsKey = join('AKIA', 'IOSFODNN7EXAMPLE');
  const googleKey = join('AIza', 'SyA'.padEnd(35, 'A'));
  const jwtLike = [
    join('eyJ', 'hbGciOiJIUzI1NiJ9'),
    join('eyJ', 'zdWIiOiIxMjM0In0'),
    join('dGV', 'zdHNpZ25hdHVyZQ'),
  ].join('.');

  it.each([
    ['github-token', githubClassic, githubClassic],
    ['github-token', githubFine, githubFine],
    ['aws-access-key', awsKey, awsKey],
    ['google-api-key', googleKey, googleKey],
    ['jwt', jwtLike, jwtLike],
  ] as const)('detects %s without echoing the secret', (category, input, secret) => {
    const result = scanSensitiveData(`value ${input}`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.findings.some((finding) => finding.category === category)).toBe(true);
    expect(result.value.redacted).not.toContain(secret);
    expect(result.value.decision).toBe('deny');
  });

  it('detects assignment-context secrets and ignores near misses', () => {
    const awsSecret = join('wJalrXUtnFEMI/', 'K7MDENG/bPxRfiCYEXAMPLEKEY');
    const assigned = scanSensitiveData(`aws_secret_access_key=${awsSecret}`);
    expect(assigned.ok && assigned.value.decision).toBe('deny');
    expect(JSON.stringify(assigned)).not.toContain('wJalrXUtnFEMI');

    const webhook = scanSensitiveData(`webhook_signing_secret=${'s'.repeat(32)}`);
    expect(webhook.ok && webhook.value.decision).toBe('deny');

    const oauth = scanSensitiveData(`client_secret=${'c'.repeat(24)}`);
    expect(oauth.ok && oauth.value.decision).toBe('deny');

    expect(scanSensitiveData('eyJhbGciOiJIUzI1NiJ9.onlytwo').ok).toBe(true);
    const twoSeg = scanSensitiveData('eyJhbGciOiJIUzI1NiJ9.onlytwo');
    expect(twoSeg.ok && twoSeg.value.decision).toBe('allow');

    const uuid = '123e4567-e89b-12d3-a456-426614174000';
    const uuidScan = scanSensitiveData(`id=${uuid}`);
    expect(uuidScan.ok && uuidScan.value.decision).toBe('allow');

    const highEntropy = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789+/==';
    const bare = scanSensitiveData(highEntropy);
    expect(bare.ok && bare.value.decision).toBe('allow');
    const assignedKey = scanSensitiveData(`api_key=${highEntropy}`);
    expect(assignedKey.ok && assignedKey.value.decision).toBe('deny');
  });

  it('detects families inside nested metadata and VoiceProfile-like fields', () => {
    const nested = scanSensitiveMetadata({
      profile: { styleNote: `token ${githubClassic}` },
    });
    expect(nested.ok && nested.value.decision).toBe('deny');
    expect(JSON.stringify(nested)).not.toContain('ghp_');
  });

  it('stays bounded on a long input', () => {
    const long = `${'word '.repeat(8_000)}api_key=${'z'.repeat(40)}`;
    const started = Date.now();
    const result = scanSensitiveData(long);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(result.ok && result.value.decision).toBe('deny');
  });
});
