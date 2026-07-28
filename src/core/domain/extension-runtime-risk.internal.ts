import type { RuntimeRiskEvidenceData } from './extension-runtime-risk.js';

export const runtimeRiskEvidenceBrand: unique symbol = Symbol('RuntimeRiskEvidence');

export interface RuntimeRiskEvidence extends RuntimeRiskEvidenceData {
  readonly [runtimeRiskEvidenceBrand]: true;
}

const freezeRecord = (value: unknown): void => {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return;
  for (const nested of Object.values(value)) freezeRecord(nested);
  Object.freeze(value);
};

/** Internal sealing factory — not exported through the public API. */
export const sealRuntimeRiskEvidence = (data: RuntimeRiskEvidenceData): RuntimeRiskEvidence => {
  const sealed = { ...data, [runtimeRiskEvidenceBrand]: true as const };
  freezeRecord(sealed);
  return sealed;
};

export const isRuntimeRiskEvidence = (value: unknown): value is RuntimeRiskEvidence =>
  typeof value === 'object' && value !== null && runtimeRiskEvidenceBrand in value;
