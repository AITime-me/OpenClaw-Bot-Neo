import { BlockList, isIPv4, isIPv6 } from 'node:net';

export type UrlSafetyDecision =
  | { readonly safe: true; readonly url: URL }
  | { readonly safe: false; readonly reason: string; readonly requiresRuntimeResolution: boolean };

/**
 * Deterministic syntax policy only. DNS resolution, resolved-IP validation, redirect
 * revalidation and DNS-rebinding protection stay future runtime gates and are not performed here.
 */
export const FUTURE_RUNTIME_GATES = Object.freeze([
  'DNS resolution of the hostname',
  'validation of every resolved IP address',
  'revalidation of every redirect hop',
  'DNS-rebinding protection between check and fetch',
] as const);
export const DNS_REBINDING_NOTE =
  'Resolved-IP, redirect and DNS-rebinding checks belong to the future runtime adapter.';

const blockedV4 = new BlockList();
blockedV4.addSubnet('0.0.0.0', 8, 'ipv4');
blockedV4.addSubnet('10.0.0.0', 8, 'ipv4');
blockedV4.addSubnet('100.64.0.0', 10, 'ipv4');
blockedV4.addSubnet('127.0.0.0', 8, 'ipv4');
blockedV4.addSubnet('169.254.0.0', 16, 'ipv4');
blockedV4.addSubnet('172.16.0.0', 12, 'ipv4');
blockedV4.addSubnet('192.0.0.0', 24, 'ipv4');
blockedV4.addSubnet('192.168.0.0', 16, 'ipv4');
blockedV4.addSubnet('198.18.0.0', 15, 'ipv4');
blockedV4.addAddress('255.255.255.255', 'ipv4');

const blockedV6 = new BlockList();
blockedV6.addAddress('::', 'ipv6');
blockedV6.addAddress('::1', 'ipv6');
blockedV6.addSubnet('fc00::', 7, 'ipv6');
blockedV6.addSubnet('fe80::', 10, 'ipv6');
blockedV6.addSubnet('ff00::', 8, 'ipv6');
blockedV6.addSubnet('64:ff9b::', 96, 'ipv6');
blockedV6.addSubnet('100::', 64, 'ipv6');

/** Both IPv4-mapped (::ffff:0:0/96) and IPv4-compatible (::/96) embeddings land here. */
const embeddedV4 = new BlockList();
embeddedV4.addSubnet('::ffff:0:0', 96, 'ipv6');
embeddedV4.addSubnet('::', 96, 'ipv6');

const RESERVED_LOCAL_SUFFIXES = [
  'localhost',
  'local',
  'localdomain',
  'internal',
  'intranet',
  'lan',
  'home.arpa',
] as const;
const DOTTED_TAIL_PATTERN = /^::(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i;

/**
 * Raw whitespace and C0/C7F control characters are refused before normalization, because the URL
 * parser silently strips them and would otherwise hide the real target.
 */
const hasRawWhitespaceOrControl = (value: string): boolean => {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
};

const tryParseUrl = (value: string): URL | null => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const deny = (reason: string): UrlSafetyDecision => ({
  safe: false,
  reason,
  requiresRuntimeResolution: false,
});

const isReservedLocalName = (host: string): boolean =>
  RESERVED_LOCAL_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));

const isBlockedV4 = (host: string): boolean => blockedV4.check(host, 'ipv4');

/**
 * Structural check only: ranges come from `node:net` block lists, and an embedded IPv4 is
 * refused whenever the canonical form no longer exposes it in dotted notation.
 */
const checkV6 = (host: string): UrlSafetyDecision | null => {
  if (blockedV6.check(host, 'ipv6'))
    return deny('IPv6 loopback, unspecified, unique-local, link-local or multicast is forbidden.');
  if (!embeddedV4.check(host, 'ipv6')) return null;
  const dotted = DOTTED_TAIL_PATTERN.exec(host)?.[1];
  if (dotted === undefined || !isIPv4(dotted))
    return deny('IPv4-embedded IPv6 literal is refused: the embedded address is not verifiable.');
  return isBlockedV4(dotted)
    ? deny('IPv4-mapped IPv6 address points at a forbidden IPv4 range.')
    : null;
};

/** Trailing dots are stripped so `localhost.` cannot bypass the reserved-name check. */
const canonicalHost = (hostname: string): string | null => {
  const bracketed = hostname.startsWith('[') && hostname.endsWith(']');
  const bare = bracketed ? hostname.slice(1, -1) : hostname;
  if (bracketed) return isIPv6(bare) ? bare.toLowerCase() : null;
  const stripped = bare.replace(/\.+$/, '').toLowerCase();
  return stripped.length === 0 ? null : stripped;
};

export function checkUrlSafety(
  input: string,
  allowedSchemes: ReadonlySet<string> = new Set(['https:']),
): UrlSafetyDecision {
  if (typeof input !== 'string' || input.length === 0) return deny('Malformed URL.');
  if (hasRawWhitespaceOrControl(input))
    return deny('Raw URL contains ASCII whitespace or control characters.');

  const url = tryParseUrl(input);
  if (url === null) return deny('Malformed URL.');
  if (!allowedSchemes.has(url.protocol)) return deny('Scheme is not allowlisted.');
  if (url.username.length > 0 || url.password.length > 0)
    return deny('URL credentials are forbidden.');

  const host = canonicalHost(url.hostname);
  if (host === null) return deny('Malformed or unsupported hostname.');
  if (isReservedLocalName(host)) return deny('Local or reserved hostname is forbidden.');
  if (isIPv4(host) && isBlockedV4(host))
    return deny('Loopback, private, link-local or metadata IPv4 literal is forbidden.');
  if (isIPv6(host)) {
    const blocked = checkV6(host);
    if (blocked) return blocked;
  }
  if (!isIPv4(host) && !isIPv6(host) && /^[\d.]+$/.test(host))
    return deny('Malformed numeric hostname.');

  return { safe: true, url };
}
