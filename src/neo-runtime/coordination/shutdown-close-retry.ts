import type { NeoRuntimeCloseResult } from '../neo-runtime.types.js';

export const NEO_SHUTDOWN_CLOSE_MAX_ATTEMPTS = 3 as const;
export const NEO_SHUTDOWN_CLOSE_RETRY_DELAY_MS = 25 as const;

export const closeRuntimeWithRetry = async (input: {
  readonly close: () => Promise<NeoRuntimeCloseResult>;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
}): Promise<
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'close-incomplete' | 'shutdown-timeout' }
> => {
  const maxAttempts = input.maxAttempts ?? NEO_SHUTDOWN_CLOSE_MAX_ATTEMPTS;
  const retryDelayMs = input.retryDelayMs ?? NEO_SHUTDOWN_CLOSE_RETRY_DELAY_MS;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await input.close();
    if (result.ok) return { ok: true };
    if (attempt < maxAttempts) await input.sleep(retryDelayMs);
  }
  return { ok: false, reason: 'shutdown-timeout' };
};
