import type { JobId, ISO8601 } from './identity.js';
export interface MediaDerivative {
  readonly derivativeId: JobId;
  readonly sourceAssetId: JobId;
  readonly kind: 'transcript' | 'analysis' | 'generated' | 'edited';
  readonly createdAt: ISO8601;
  readonly contentRef: string;
}
