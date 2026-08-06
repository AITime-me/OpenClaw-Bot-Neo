/**
 * One-shot owner-approved live-spawn capability.
 * Created only by the manual owner probe script after exact confirmation.
 * Authority and consumed state live in module-private WeakSet maps — clone/spread/reset cannot forge reuse.
 */

import { randomBytes } from 'node:crypto';

const issuedAuthority = new WeakSet();
const consumedAuthority = new WeakSet();

export type CodexOwnerSpawnCapability = {
  readonly nonce: string;
};

export const OWNER_PROBE_CONFIRMATION_VALUE =
  'OWNER_APPROVE_SINGLE_NON_PERSISTENT_CODEX_PROBE' as const;

export const issueOwnerSpawnCapability = (input: {
  readonly confirmation: string | undefined;
}):
  | { readonly ok: true; readonly capability: CodexOwnerSpawnCapability }
  | { readonly ok: false; readonly reason: string } => {
  if (input.confirmation !== OWNER_PROBE_CONFIRMATION_VALUE)
    return { ok: false, reason: 'owner confirmation missing or incorrect' };
  const capability = Object.freeze({
    nonce: `owner-probe-${randomBytes(16).toString('hex')}`,
  });
  issuedAuthority.add(capability);
  return { ok: true, capability };
};

export const isOwnerSpawnCapability = (value: unknown): value is CodexOwnerSpawnCapability => {
  if (value === null || typeof value !== 'object') return false;
  return issuedAuthority.has(value);
};

export const consumeOwnerSpawnCapability = (
  capability: CodexOwnerSpawnCapability,
): { readonly ok: true } | { readonly ok: false; readonly reason: string } => {
  if (!issuedAuthority.has(capability))
    return { ok: false, reason: 'invalid owner spawn capability' };
  if (consumedAuthority.has(capability))
    return { ok: false, reason: 'owner spawn capability already consumed' };
  consumedAuthority.add(capability);
  return { ok: true };
};
