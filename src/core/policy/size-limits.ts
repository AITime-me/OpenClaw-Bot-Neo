export const checkSizeLimit = (
  size: number,
  maximum: number,
): { readonly allowed: boolean; readonly reason?: string } =>
  size >= 0 && maximum > 0 && size <= maximum
    ? { allowed: true }
    : { allowed: false, reason: 'Size limit exceeded or invalid.' };
