import {
  ok,
  type DomainError,
  type MemoryWriteDecision,
  type Result,
} from '../../core/domain/index.js';
import type { MemoryPolicyPort } from '../../core/ports/index.js';

/**
 * Fail-closed default for local composition. Local mode is not a reason to allow writes.
 */
export function createDenyByDefaultMemoryPolicy(): MemoryPolicyPort {
  return {
    evaluate: (): Promise<Result<MemoryWriteDecision, DomainError>> =>
      Promise.resolve(
        ok({
          decision: 'deny',
          reason: 'Local host default memory policy is deny-by-default.',
        }),
      ),
  };
}

/**
 * Explicit allow policy for local happy-path composition. Must be injected deliberately;
 * never selected as a hidden fallback.
 */
export function createExplicitAllowMemoryPolicy(): MemoryPolicyPort {
  return {
    evaluate: (): Promise<Result<MemoryWriteDecision, DomainError>> =>
      Promise.resolve(ok({ decision: 'allow' })),
  };
}
