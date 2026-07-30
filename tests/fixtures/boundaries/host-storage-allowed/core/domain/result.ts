export const ok = <T>(value: T): { readonly ok: true; readonly value: T } => ({
  ok: true,
  value,
});
