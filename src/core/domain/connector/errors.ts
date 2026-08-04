export type ToolExecutionErrorCode =
  | 'invalid-input'
  | 'tool-not-found'
  | 'connector-not-found'
  | 'connection-not-found'
  | 'capability-denied'
  | 'policy-denied'
  | 'approval-required'
  | 'approval-denied'
  | 'approval-expired'
  | 'secret-unavailable'
  | 'connector-unavailable'
  | 'timeout'
  | 'cancelled'
  | 'rate-limited'
  | 'remote-error'
  | 'invalid-remote-response'
  | 'internal-error';

export type ExecutionState = 'not-started' | 'started' | 'outcome-unknown' | 'completed';

export interface ToolExecutionError {
  readonly code: ToolExecutionErrorCode;
  readonly reason: string;
  readonly executionState: ExecutionState;
}
