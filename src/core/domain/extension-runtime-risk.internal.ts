import type { RuntimeRiskEvidenceData } from './extension-runtime-risk.js';
import { deepFreeze } from './immutable.js';

export type RuntimeRiskEvidence = RuntimeRiskEvidenceData;

const runtimeRiskRegistry = new WeakMap<object, RuntimeRiskEvidenceData>();

/** Internal sealing factory — not exported through the public API. */
export const sealRuntimeRiskEvidence = (data: RuntimeRiskEvidenceData): RuntimeRiskEvidence => {
  const sealed = deepFreeze({ ...data });
  runtimeRiskRegistry.set(sealed, { ...data });
  return sealed;
};

export const isRuntimeRiskEvidence = (value: unknown): value is RuntimeRiskEvidence =>
  typeof value === 'object' && value !== null && runtimeRiskRegistry.has(value);

export const getRuntimeRiskEvidenceCanonical = (
  value: RuntimeRiskEvidence,
): RuntimeRiskEvidenceData | null => runtimeRiskRegistry.get(value) ?? null;
