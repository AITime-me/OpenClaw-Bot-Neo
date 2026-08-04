import type {
  OpaqueSecretHandle,
  SecretProviderFailure,
  SecretReferenceMetadata,
} from '../domain/connector/secret.js';
import type { Result } from '../domain/result.js';
import type { ToolInvocationContext } from '../domain/connector/invocation.js';

export interface ConnectorSecretProvider {
  resolveHandle(
    reference: SecretReferenceMetadata,
    context: ToolInvocationContext,
  ): Promise<Result<OpaqueSecretHandle, SecretProviderFailure>>;
}
