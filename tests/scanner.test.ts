import { describe, expect, it } from 'vitest';
import { err } from '../src/core/domain/index.js';
import { maskSecrets, scanSensitiveData, scanWithFailClosed } from '../src/core/policy/index.js';

describe('sensitive-data scanner', () => {
  it.each([
    [
      'telegram-bot-token',
      `Token ${['123456789', ':', 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcd1234'].join('')}`,
    ],
    ['bearer-token', 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz'],
    [
      'url-credentials',
      `Use ${['https://', 'alice', ':', 'secret', '@', 'example.com/path'].join('')}`,
    ],
    ['password', 'password=hunter2'],
    ['api-key', 'api_key=abcdefghijklmnopqrstuvwxyz'],
    ['connection-string', 'postgresql://admin:secret@example.com/database'],
  ] as const)('detects %s without returning its value', (category, input) => {
    const result = scanSensitiveData(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision).toBe('deny');
    expect(result.value.findings.some((finding) => finding.category === category)).toBe(true);
    expect(result.value.redacted).not.toContain('secret');
    expect(result.value.findings.map((finding) => finding.maskedPreview).join()).not.toContain(
      input,
    );
  });

  it('detects a PEM private key block', () => {
    const input = [
      '-----BEGIN' + ' PRIVATE KEY-----',
      'synthetic-material',
      '-----END' + ' PRIVATE KEY-----',
    ].join('\n');
    const result = scanSensitiveData(input);
    expect(result.ok && result.value.findings[0]?.category).toBe('private-key');
    expect(result.ok && result.value.redacted).not.toContain('synthetic-material');
  });

  it('fails closed when the scanner fails', () => {
    const report = scanWithFailClosed('safe', () =>
      err({ code: 'SCANNER_FAILURE', reason: 'synthetic failure' }),
    );
    expect(report.decision).toBe('deny');
    expect(report.redacted).not.toContain('safe');
  });

  it('masks idempotently', () => {
    const once = maskSecrets('password=hunter2');
    expect(maskSecrets(once)).toBe(once);
  });

  it('does not mask ordinary safe text', () => {
    const input = 'Подготовь безопасный отчёт по проекту.';
    expect(maskSecrets(input)).toBe(input);
    const result = scanSensitiveData(input);
    expect(result.ok && result.value.decision).toBe('allow');
  });
});
