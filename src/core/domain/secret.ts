/**
 * Opaque secret-bearing value. Raw material is not exposed through this interface.
 * Construction and material access are module-private; trust is runtime seal membership.
 */
export interface SecretData {
  readonly kind: 'secret-data';
}

/**
 * Opaque secret handle without material. Persistence contract is deferred.
 */
export interface SecretReference {
  readonly kind: 'secret-reference';
  readonly referenceId: string;
  readonly providerNamespace: string;
}

/** Trusted adapters mark credential-originating memory content before invoke. */
export type MemoryContentSensitivity = 'secret-class';
