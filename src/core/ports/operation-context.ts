import type { ISO8601 } from '../domain/index.js';
export interface OperationContext {
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly deadline: ISO8601;
}
