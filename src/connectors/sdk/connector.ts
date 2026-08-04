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

export interface ConnectorExecutionError {
  readonly code: ConnectorExecutionErrorCode;
  readonly reason: string;
  readonly category: 'remote' | 'timeout' | 'cancelled' | 'internal' | 'invalid-response';
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
