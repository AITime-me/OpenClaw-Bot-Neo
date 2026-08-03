export const NEO_BOOT_ID_MAX_LENGTH = 64 as const;

const BOOT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const normalizeBootId = (input: string): string | null => {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > NEO_BOOT_ID_MAX_LENGTH) return null;
  if (!BOOT_ID_PATTERN.test(trimmed)) return null;
  return trimmed;
};
