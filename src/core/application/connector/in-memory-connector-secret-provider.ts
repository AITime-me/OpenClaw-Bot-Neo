import type { ConnectorSecretProvider } from '../../ports/connector-secret-provider.port.js';
import type {
  OpaqueSecretHandle,
  SecretProviderFailure,
  SecretReferenceMetadata,
} from '../../domain/connector/secret.js';
import type { SecretHandleId } from '../../domain/connector/identity.js';
import { err, ok, type Result } from '../../domain/result.js';
import type { ToolInvocationContext } from '../../domain/connector/invocation.js';
import { CONNECTOR_SECRET_PROVIDER_CONFIGURED } from '../../domain/connector/constants.js';

export const createInMemoryConnectorSecretProvider = (
  references: ReadonlyMap<string, SecretHandleId> = new Map(),
): ConnectorSecretProvider & {
  readonly resolveCalls: number;
  readonly configured: false;
} => {
  let resolveCalls = 0;
  return {
    get resolveCalls() {
      return resolveCalls;
    },
    configured: CONNECTOR_SECRET_PROVIDER_CONFIGURED,
    resolveHandle(
      reference: SecretReferenceMetadata,
      _context: ToolInvocationContext,
    ): Promise<Result<OpaqueSecretHandle, SecretProviderFailure>> {
      void _context;
      resolveCalls += 1;
      const handleId = references.get(reference.secretReferenceId);
      if (handleId === undefined)
        return Promise.resolve(
          err({ code: 'NOT_FOUND', reason: 'Secret reference is unavailable.' }),
        );
      return Promise.resolve(ok({ secretHandleId: handleId }));
    },
  };
};

export const createTestConnectorSecretProvider = (
  references: ReadonlyMap<string, SecretHandleId>,
): ConnectorSecretProvider & { readonly resolveCalls: number } => {
  let resolveCalls = 0;
  return {
    get resolveCalls() {
      return resolveCalls;
    },
    resolveHandle(
      reference: SecretReferenceMetadata,
      _context: ToolInvocationContext,
    ): Promise<Result<OpaqueSecretHandle, SecretProviderFailure>> {
      void _context;
      resolveCalls += 1;
      const handleId = references.get(reference.secretReferenceId);
      if (handleId === undefined)
        return Promise.resolve(
          err({ code: 'UNAVAILABLE', reason: 'Secret reference is unavailable.' }),
        );
      return Promise.resolve(ok({ secretHandleId: handleId }));
    },
  };
};
