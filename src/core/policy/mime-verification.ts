export type MimeDecision =
  | { readonly valid: true; readonly detected: string }
  | { readonly valid: false; readonly reason: string };
export function verifyKnownSignature(bytes: Uint8Array, declared: string): MimeDecision {
  const detected =
    bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
      ? 'application/pdf'
      : bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
        ? 'image/png'
        : null;
  if (detected === null) return { valid: false, reason: 'Unsupported or unverified signature.' };
  return detected === declared
    ? { valid: true, detected }
    : { valid: false, reason: 'Declared MIME does not match content.' };
}
