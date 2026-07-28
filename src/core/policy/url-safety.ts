export type UrlSafetyDecision =
  | { readonly safe: true; readonly url: URL }
  | { readonly safe: false; readonly reason: string; readonly requiresRuntimeResolution: boolean };
const privateV4 = (host: string): boolean => {
  const octets = host.split('.').map(Number);
  if (
    octets.length !== 4 ||
    octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  )
    return false;
  const [a, b] = octets;
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b !== undefined && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
};
export function checkUrlSafety(
  input: string,
  allowedSchemes: ReadonlySet<string> = new Set(['https:']),
): UrlSafetyDecision {
  try {
    const url = new URL(input);
    if (!allowedSchemes.has(url.protocol))
      return {
        safe: false,
        reason: 'Scheme is not allowlisted.',
        requiresRuntimeResolution: false,
      };
    if (url.username || url.password)
      return {
        safe: false,
        reason: 'URL credentials are forbidden.',
        requiresRuntimeResolution: false,
      };
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host === '::1' ||
      privateV4(host) ||
      host === '169.254.169.254'
    ) {
      return {
        safe: false,
        reason: 'Local, private, link-local, or metadata target is forbidden.',
        requiresRuntimeResolution: false,
      };
    }
    return { safe: true, url };
  } catch {
    return { safe: false, reason: 'Malformed URL.', requiresRuntimeResolution: false };
  }
}
export const DNS_REBINDING_NOTE =
  'Resolved-IP and DNS-rebinding checks belong to the future runtime adapter.';
