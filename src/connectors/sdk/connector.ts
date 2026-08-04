import type { JsonObject } from '../../core/domain/connector/json.js';
import type { VerifiedToolManifest } from '../../core/domain/connector/manifest-validation.js';
import type { IdempotencyKey } from '../../core/domain/connector/identity.js';
import type { OpaqueSecretHandle } from '../../core/domain/connector/secret.js';
import type { ConnectorId } from '../../core/domain/connector/identity.js';

export type ConnectorHealthStatus = 'healthy' | 'degraded' | 'unavailable';

export interface ConnectorHealthResult {
  readonly status: ConnectorHealthStatus;
  readonly retryAfterMs: number | null;
}

export type ConnectorExecutionErrorCode =
  'unavailable' | 'timeout' | 'cancelled' | 'remote-error' | 'invalid-output';

/**
 * Connector-local execution outcome for failures.
 * Authority for ToolInvocationOrchestrator write-like mapping; not model/tool input.
 */
export const CONNECTOR_LOCAL_EXECUTION_OUTCOMES = Object.freeze([
  'known-failure',
  'outcome-unknown',
] as const);

export type ConnectorLocalExecutionOutcome = (typeof CONNECTOR_LOCAL_EXECUTION_OUTCOMES)[number];

export const parseConnectorLocalExecutionOutcome = (
  value: unknown,
): ConnectorLocalExecutionOutcome => {
  if (value === 'outcome-unknown') return 'outcome-unknown';
  return 'known-failure';
};

export interface ConnectorExecutionError {
  readonly code: ConnectorExecutionErrorCode;
  readonly reason: string;
  readonly category: 'remote' | 'timeout' | 'cancelled' | 'internal' | 'invalid-response';
  /**
   * Explicit connector-local outcome. Absent or malformed values normalize to known-failure.
   * Only write-like tools may map outcome-unknown to ToolInvocationResult executionState.
   */
  readonly executionOutcome?: ConnectorLocalExecutionOutcome;
}

export interface ConnectorExecutionSuccess {
  readonly ok: true;
  readonly output: JsonObject;
}

export interface ConnectorExecutionFailure {
  readonly ok: false;
  readonly error: ConnectorExecutionError;
}

export type ConnectorExecutionResult = ConnectorExecutionSuccess | ConnectorExecutionFailure;

export const connectorExecutionFailure = (error: {
  readonly code: ConnectorExecutionErrorCode;
  readonly reason: string;
  readonly category: ConnectorExecutionError['category'];
  readonly executionOutcome?: ConnectorLocalExecutionOutcome;
}): ConnectorExecutionFailure => ({
  ok: false,
  error: Object.freeze({
    code: error.code,
    reason: error.reason,
    category: error.category,
    executionOutcome: parseConnectorLocalExecutionOutcome(error.executionOutcome),
  }),
});

export interface ConnectorExecutionContext {
  readonly connectorId: ConnectorId;
  readonly invocationLabel: string;
}

export interface ConnectorExecuteRequest {
  readonly tool: VerifiedToolManifest;
  readonly input: JsonObject;
  readonly secretHandle: OpaqueSecretHandle | null;
  readonly idempotencyKey: IdempotencyKey | null;
  readonly signal: AbortSignal;
  readonly context: ConnectorExecutionContext;
}

export interface Connector {
  readonly connectorId: ConnectorId;
  initialize(): Promise<void>;
  health(): Promise<ConnectorHealthResult>;
  listTools(): readonly VerifiedToolManifest[];
  discoverCapabilities(): readonly import('../../core/domain/connector/capabilities.js').ToolCapability[];
  execute(request: ConnectorExecuteRequest): Promise<ConnectorExecutionResult>;
  shutdown(): Promise<void>;
}
