/**
 * One-shot owner-approved live-spawn capability.
 * Created only by the manual owner probe script after exact confirmation.
 * Generic LLM/probe factories cannot spawn a live Codex child without this token.
 */

const CAPABILITY_BRAND = Symbol('CodexOwnerSpawnCapability');

export type CodexOwnerSpawnCapability = {
  readonly [CAPABILITY_BRAND]: true;
  readonly issuedAtMs: number;
  readonly nonce: string;
  consumed: boolean;
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
  return {
    ok: true,
    capability: {
      [CAPABILITY_BRAND]: true,
      issuedAtMs: Date.now(),
      nonce: `owner-probe-${String(Date.now())}-${Math.random().toString(16).slice(2)}`,
      consumed: false,
    },
  };
};

export const isOwnerSpawnCapability = (value: unknown): value is CodexOwnerSpawnCapability => {
  if (value === null || typeof value !== 'object') return false;
  return (value as { [CAPABILITY_BRAND]?: unknown })[CAPABILITY_BRAND] === true;
};

export const consumeOwnerSpawnCapability = (
  capability: CodexOwnerSpawnCapability,
): { readonly ok: true } | { readonly ok: false; readonly reason: string } => {
  if (!isOwnerSpawnCapability(capability))
    return { ok: false, reason: 'invalid owner spawn capability' };
  if (capability.consumed) return { ok: false, reason: 'owner spawn capability already consumed' };
  capability.consumed = true;
  return { ok: true };
};
