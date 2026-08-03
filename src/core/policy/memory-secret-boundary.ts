import { isSecretData, isSecretReference } from '../domain/secret.internal.js';
import type { MemoryContentSensitivity } from '../domain/secret.js';

export type MemorySecretBoundaryFailure = { readonly code: 'SECRET_CLASS_DENIED' };

const MAX_METADATA_SECRET_TRAVERSAL_NODES = 64;

const containsSecretMaterial = (value: unknown, budget: { nodes: number }): boolean => {
  if (isSecretData(value) || isSecretReference(value)) return true;
  if (value === null || typeof value !== 'object') return false;
  if (budget.nodes >= MAX_METADATA_SECRET_TRAVERSAL_NODES) return true;
  budget.nodes += 1;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (containsSecretMaterial(item, budget)) return true;
    }
    return false;
  }
  for (const key of Object.keys(value)) {
    const record = value as { readonly [key: string]: unknown };
    const item = record[key];
    if (containsSecretMaterial(item, budget)) return true;
  }
  return false;
};

/**
 * Mandatory non-overrideable secret boundary for memory writes. Product policy cannot downgrade
 * or revive a secret-class rejection. Scanner-unknown but explicitly secret-tainted content fails
 * here without relying on pattern detection.
 */
export const evaluateMemorySecretBoundary = (input: {
  readonly contentSensitivity?: MemoryContentSensitivity;
  readonly rawContent: unknown;
  readonly rawMetadata: Readonly<Record<string, unknown>>;
}): { readonly allowed: true } | MemorySecretBoundaryFailure => {
  if (input.contentSensitivity === 'secret-class') return { code: 'SECRET_CLASS_DENIED' };
  if (isSecretData(input.rawContent)) return { code: 'SECRET_CLASS_DENIED' };
  if (containsSecretMaterial(input.rawMetadata, { nodes: 0 }))
    return { code: 'SECRET_CLASS_DENIED' };
  return { allowed: true };
};
