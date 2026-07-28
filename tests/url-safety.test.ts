import { describe, expect, it } from 'vitest';
import { checkUrlSafety, FUTURE_RUNTIME_GATES } from '../src/core/policy/index.js';
import { URL_WITH_ENCODED_CREDENTIALS } from './support/synthetic-secrets.js';

const blocked = (input: string): boolean => !checkUrlSafety(input).safe;

describe('raw input and syntax', () => {
  it.each([
    ' https://example.com/',
    'https://example.com/ ',
    '\thttps://example.com/',
    'https://exa\nmple.com/',
    'not-a-url',
    '',
    'https://',
  ])('rejects raw input %j', (input) => {
    expect(blocked(input)).toBe(true);
  });

  it.each(['http://example.com/', 'file:///etc/passwd', 'ftp://example.com/', 'data:text/plain,x'])(
    'rejects scheme in %s',
    (input) => {
      expect(blocked(input)).toBe(true);
    },
  );

  it('allows an explicitly permitted extra scheme', () => {
    expect(checkUrlSafety('http://example.com/', new Set(['http:'])).safe).toBe(true);
  });
});

describe('credentials', () => {
  it.each([
    ['plain userinfo', ['https://', 'bob', ':', 'pw', '@', 'example.com/'].join('')],
    ['percent-encoded userinfo', URL_WITH_ENCODED_CREDENTIALS],
    ['username only', ['https://', 'bob', '@', 'example.com/'].join('')],
  ])('rejects %s', (_label, input) => {
    expect(blocked(input)).toBe(true);
  });
});

describe('local and reserved hostnames', () => {
  it.each([
    'https://localhost/path',
    'https://LOCALHOST/path',
    'https://localhost./path',
    'https://api.localhost/path',
    'https://service.internal/path',
    'https://printer.local/path',
    'https://box.home.arpa/path',
  ])('rejects %s', (input) => {
    expect(blocked(input)).toBe(true);
  });
});

describe('IPv4 literals', () => {
  it.each([
    'https://127.0.0.1/path',
    'https://127.0.0.1./path',
    'https://10.1.2.3/path',
    'https://172.16.4.5/path',
    'https://172.31.255.254/path',
    'https://192.168.1.2/path',
    'https://169.254.1.1/path',
    'https://169.254.169.254/latest/meta-data',
    'https://100.100.100.200/latest',
    'https://0.0.0.0/path',
    'https://255.255.255.255/path',
    'https://2130706433/path',
  ])('rejects %s', (input) => {
    expect(blocked(input)).toBe(true);
  });

  it('allows a public IPv4 literal', () => {
    expect(checkUrlSafety('https://93.184.216.34/path').safe).toBe(true);
  });
});

describe('IPv6 literals', () => {
  it.each([
    'https://[::1]/path',
    'https://[::]/path',
    'https://[fc00::1]/path',
    'https://[fd12:3456::1]/path',
    'https://[fe80::1]/path',
    'https://[ff02::1]/path',
    'https://[::ffff:127.0.0.1]/path',
    'https://[::ffff:10.0.0.1]/path',
    'https://[::127.0.0.1]/path',
    'https://[::1',
    'https://[not-ipv6]/path',
    'https://[:::1]/path',
  ])('rejects %s', (input) => {
    expect(blocked(input)).toBe(true);
  });

  it('allows a public IPv6 literal', () => {
    expect(checkUrlSafety('https://[2606:2800:220:1:248:1893:25c8:1946]/path').safe).toBe(true);
  });
});

describe('allowed public syntax and documented gaps', () => {
  it.each([
    'https://example.com/resource',
    'https://sub.example.co.uk/path?query=1',
    'https://example.com:8443/resource',
  ])('allows %s', (input) => {
    const decision = checkUrlSafety(input);
    expect(decision.safe).toBe(true);
  });

  it('documents the runtime gates that are still missing', () => {
    expect(FUTURE_RUNTIME_GATES).toContain('DNS resolution of the hostname');
    expect(FUTURE_RUNTIME_GATES).toContain('revalidation of every redirect hop');
  });
});
