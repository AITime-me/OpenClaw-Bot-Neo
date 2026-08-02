import type { CreatePosixDurableLocalHostInput } from '../../host/durable/create-posix-durable-local-host.js';
import { createPosixDurableLocalHost } from '../../host/durable/create-posix-durable-local-host.js';
import { createNeoRuntime, type NeoRuntimeDurableOpenResult } from '../create-neo-runtime.js';
import type { NeoRuntime } from '../neo-runtime.types.js';

export interface ProductionNeoRuntimeConfig {
  readonly compositionInput: CreatePosixDurableLocalHostInput;
}

const mapCompositionResult = (
  result: Awaited<ReturnType<typeof createPosixDurableLocalHost>>,
): NeoRuntimeDurableOpenResult => {
  if (result.ok) {
    const owner = result.value;
    return {
      ok: true,
      value: {
        close: () => {
          const closed = owner.close();
          if (closed.ok) return { ok: true as const };
          return {
            ok: false as const,
            error: {
              code: closed.error.code,
              reason: closed.error.reason,
              stage: closed.error.stage,
            },
          };
        },
      },
    };
  }

  if ('error' in result && typeof result.error.code === 'string') {
    return {
      ok: false,
      error: {
        code: result.error.code,
        reason: result.error.reason,
      },
    };
  }

  return {
    ok: false,
    error: {
      code: 'DURABLE_COMPOSITION_OWNERSHIP_CLEANUP_REQUIRED',
      reason: 'Durable composition ownership cleanup is required.',
    },
  };
};

/**
 * Production Neo runtime entry. Sole neo-runtime module allowed to import the real durable factory.
 * Accepts pre-parsed composition input only — no filesystem or environment access.
 */
export const createProductionNeoRuntime = (config: ProductionNeoRuntimeConfig): NeoRuntime =>
  createNeoRuntime({
    openDurableHost: async () =>
      mapCompositionResult(await createPosixDurableLocalHost(config.compositionInput)),
  });
