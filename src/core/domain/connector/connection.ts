import type { ToolCapability } from './capabilities.js';
import type { ConnectorId, ConnectionId, SecretReferenceId } from './identity.js';
import type { ISO8601 } from '../identity.js';

export const CONNECTION_STATUSES = Object.freeze(['active', 'suspended', 'revoked'] as const);
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export interface SecretReference {
  readonly secretReferenceId: SecretReferenceId;
  readonly connectorId: ConnectorId;
}

export interface AccountConnection {
  readonly connectionId: ConnectionId;
  readonly connectorId: ConnectorId;
  readonly accountIdentity: string;
  readonly status: ConnectionStatus;
  readonly allowedCapabilities: readonly ToolCapability[];
  readonly secretReference: SecretReference | null;
  readonly createdAt: ISO8601;
  readonly updatedAt: ISO8601;
}

export type ConnectionFailureCode =
  | 'CONNECTOR_NOT_FOUND'
  | 'CONNECTOR_MISMATCH'
  | 'UNDECLARED_CAPABILITY'
  | 'INVALID_STATUS'
  | 'CREDENTIAL_FIELD'
  | 'DUPLICATE';

export interface ConnectionFailure {
  readonly code: ConnectionFailureCode;
  readonly reason: string;
}
