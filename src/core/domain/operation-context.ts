import type { ISO8601 } from './identity.js';
import { parseISO8601 } from './identity.js';
export interface OperationContext {
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly deadline: ISO8601;
}
export type OperationContextFailure =
  | { readonly code: 'MISSING_OPERATION_CONTEXT' }
  | { readonly code: 'INVALID_TIMEOUT' }
  | { readonly code: 'INVALID_DEADLINE' }
  | { readonly code: 'ALREADY_CANCELLED' };
export function validateOperationContext(
  context: OperationContext | null | undefined,
): OperationContextFailure | null {
  if (!context || typeof context !== 'object') return { code: 'MISSING_OPERATION_CONTEXT' };
  if (!(context.signal instanceof AbortSignal)) return { code: 'MISSING_OPERATION_CONTEXT' };
  if (!Number.isFinite(context.timeoutMs) || context.timeoutMs <= 0)
    return { code: 'INVALID_TIMEOUT' };
  if (!parseISO8601(context.deadline).ok) return { code: 'INVALID_DEADLINE' };
  if (context.signal.aborted) return { code: 'ALREADY_CANCELLED' };
  return null;
}
