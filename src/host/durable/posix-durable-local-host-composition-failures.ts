import { type Result } from '../../core/domain/result.js';

/**
 * Startup / cleanup stage tags safe for failure surfaces. Never carry path/fd/handle details.
 */
export type PosixDurableCompositionStage = 'sqlite' | 'process-lock' | 'storage-root';

export type PosixDurableCompositionFailureCode =
  | 'DURABLE_COMPOSITION_UNAVAILABLE'
  | 'DURABLE_COMPOSITION_LOCK_HELD'
  | 'DURABLE_STORAGE_BOOTSTRAP_FAILED'
  | 'DURABLE_COMPOSITION_ASSEMBLY_FAILED'
  | 'DURABLE_COMPOSITION_OWNERSHIP_CLEANUP_REQUIRED';

/**
 * Redacted durable composition failure. Must not carry storage path, database/lock filename,
 * fd, uid, lease count, errno, syscall, native package path, raw cause, or stack.
 */
export interface PosixDurableCompositionFailure {
  readonly code: PosixDurableCompositionFailureCode;
  readonly reason: string;
  readonly stage?: PosixDurableCompositionStage;
}

/**
 * Ordinary composition failure returned after startup resources are fully cleaned.
 * Successful resource cleanup is not a successful composition startup.
 */
export type PosixDurableCompositionOrdinaryFailure = {
  readonly ok: false;
  readonly error: PosixDurableCompositionFailure;
};

export type PosixDurableCompositionPendingCleanup = {
  readonly retry: () => PosixDurableCompositionCleanupResult;
};

export type PosixDurableCompositionCleanupRequired = {
  readonly ok: false;
  readonly error: {
    readonly code: 'DURABLE_COMPOSITION_OWNERSHIP_CLEANUP_REQUIRED';
    readonly reason: string;
    readonly stage: PosixDurableCompositionStage;
  };
  readonly pendingCleanup: PosixDurableCompositionPendingCleanup;
};

/**
 * Cleanup retry outcome:
 * - ownership cleanup still required (resources remain owned);
 * - terminal ordinary composition failure after full cleanup (startup still failed).
 *
 * Never `{ ok: true }`: cleanup success does not mean composition success.
 */
export type PosixDurableCompositionCleanupResult =
  PosixDurableCompositionCleanupRequired | PosixDurableCompositionOrdinaryFailure;

export const failComposition = (
  code: Exclude<
    PosixDurableCompositionFailureCode,
    'DURABLE_COMPOSITION_OWNERSHIP_CLEANUP_REQUIRED'
  >,
  reason: string,
  stage?: PosixDurableCompositionStage,
): PosixDurableCompositionOrdinaryFailure =>
  Object.freeze({
    ok: false as const,
    error: Object.freeze(stage === undefined ? { code, reason } : { code, reason, stage }),
  });

export const failCompositionCleanupRequired = (
  stage: PosixDurableCompositionStage,
  pendingCleanup: PosixDurableCompositionPendingCleanup,
): PosixDurableCompositionCleanupRequired =>
  Object.freeze({
    ok: false as const,
    error: Object.freeze({
      code: 'DURABLE_COMPOSITION_OWNERSHIP_CLEANUP_REQUIRED' as const,
      reason: `Durable composition ownership cleanup required at ${stage} stage.`,
      stage,
    }),
    pendingCleanup,
  });

// Keep Result imported for documentation alignment with other failure modules.
export type PosixDurableCompositionOrdinaryResult = Result<never, PosixDurableCompositionFailure>;
