import { err, ok, type Result } from '../../core/domain/result.js';

/**
 * Shutdown stage tags safe for failure surfaces. Never carry path/fd/handle details.
 */
export type DurableLocalHostOwnerCloseStage =
  'operations' | 'memory' | 'process-lock' | 'storage-root';

export type DurableLocalHostOwnerCloseFailureCode =
  'DURABLE_HOST_CLOSE_BUSY' | 'DURABLE_HOST_CLOSE_FAILED';

export interface DurableLocalHostOwnerCloseFailure {
  readonly code: DurableLocalHostOwnerCloseFailureCode;
  readonly reason: string;
  readonly stage: DurableLocalHostOwnerCloseStage;
}

export type DurableLocalHostOwnerCloseResult = Result<void, DurableLocalHostOwnerCloseFailure>;

/**
 * Narrow Result returned by injected resource closures. Callers must not put path/fd/cause here.
 */
export type DurableResourceCloseFailure = {
  readonly code: 'RESOURCE_CLOSE_FAILED';
  readonly reason: string;
};

export type DurableResourceCloseResult = Result<void, DurableResourceCloseFailure>;

export const okDurableClose = (): DurableLocalHostOwnerCloseResult => ok(undefined);

export const failDurableCloseBusy = (): DurableLocalHostOwnerCloseResult =>
  err(
    Object.freeze({
      code: 'DURABLE_HOST_CLOSE_BUSY' as const,
      reason: 'Durable local host close is waiting for active operations.',
      stage: 'operations' as const,
    }),
  );

export const failDurableCloseStage = (
  stage: Exclude<DurableLocalHostOwnerCloseStage, 'operations'>,
): DurableLocalHostOwnerCloseResult =>
  err(
    Object.freeze({
      code: 'DURABLE_HOST_CLOSE_FAILED' as const,
      reason: `Durable local host close failed at ${stage} stage.`,
      stage,
    }),
  );

export const okResourceClose = (): DurableResourceCloseResult => ok(undefined);

export const failResourceClose = (reason: string): DurableResourceCloseResult =>
  err({
    code: 'RESOURCE_CLOSE_FAILED',
    reason,
  });
