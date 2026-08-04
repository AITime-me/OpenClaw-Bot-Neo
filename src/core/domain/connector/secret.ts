import type { SecretHandleId, SecretReferenceId, ConnectorId } from './identity.js';

export interface SecretReferenceMetadata {
  readonly secretReferenceId: SecretReferenceId;
  readonly connectorId: ConnectorId;
}

export interface OpaqueSecretHandle {
  readonly secretHandleId: SecretHandleId;
}

export type SecretProviderFailureCode = 'NOT_CONFIGURED' | 'NOT_FOUND' | 'UNAVAILABLE';

export interface SecretProviderFailure {
  readonly code: SecretProviderFailureCode;
  readonly reason: string;
}
