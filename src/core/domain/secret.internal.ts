import { deepFreeze } from './immutable.js';
import type { SecretData, SecretReference } from './secret.js';

interface SecretDataCanonical {
  readonly material: string;
}

interface SecretReferenceCanonical {
  readonly referenceId: string;
  readonly providerNamespace: string;
}

const secretDataRegistry = new WeakMap<object, SecretDataCanonical>();
const secretReferenceRegistry = new WeakMap<object, SecretReferenceCanonical>();

const bindOpaqueObjectMethods = (view: object): void => {
  Object.defineProperty(view, 'toString', {
    value: (): string => '[opaque-secret]',
    enumerable: false,
    configurable: false,
  });
  Object.defineProperty(view, 'valueOf', {
    value: (): string => '[opaque-secret]',
    enumerable: false,
    configurable: false,
  });
};

/** App-private factory for trusted secret producers and tests. Not part of the public API. */
export const sealSecretData = (material: string): SecretData => {
  if (typeof material !== 'string') throw new TypeError('Secret material must be a string.');
  const view = { kind: 'secret-data' as const };
  bindOpaqueObjectMethods(view);
  const sealed = deepFreeze(view);
  secretDataRegistry.set(sealed, { material });
  return sealed;
};

/** App-private factory for opaque secret references. Not part of the public API. */
export const sealSecretReference = (
  referenceId: string,
  providerNamespace: string,
): SecretReference => {
  if (typeof referenceId !== 'string' || referenceId.length === 0)
    throw new TypeError('Secret reference id must be a non-empty string.');
  if (typeof providerNamespace !== 'string' || providerNamespace.length === 0)
    throw new TypeError('Secret provider namespace must be a non-empty string.');
  const view = {
    kind: 'secret-reference' as const,
    referenceId,
    providerNamespace,
  };
  bindOpaqueObjectMethods(view);
  const sealed = deepFreeze(view);
  secretReferenceRegistry.set(sealed, { referenceId, providerNamespace });
  return sealed;
};

export const isSecretData = (value: unknown): value is SecretData =>
  typeof value === 'object' && value !== null && secretDataRegistry.has(value);

export const isSecretReference = (value: unknown): value is SecretReference =>
  typeof value === 'object' && value !== null && secretReferenceRegistry.has(value);

export const getSecretDataCanonical = (value: SecretData): SecretDataCanonical | null =>
  secretDataRegistry.get(value) ?? null;

export const getSecretReferenceCanonical = (
  value: SecretReference,
): SecretReferenceCanonical | null => secretReferenceRegistry.get(value) ?? null;

/**
 * Narrow trusted consumer boundary for secret material. Memory-writing code must not call this.
 */
export const readSecretMaterialForTrustedConsumer = (value: SecretData): string | null => {
  if (!isSecretData(value)) return null;
  return getSecretDataCanonical(value)?.material ?? null;
};
