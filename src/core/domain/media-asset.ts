import type { JobId, ISO8601 } from './identity.js';
import type { MediaKind } from './media-kind.js';
import type { PrivacyClassification } from './privacy.js';
export interface MediaAsset {
  readonly assetId: JobId;
  readonly kind: MediaKind;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly createdAt: ISO8601;
  readonly privacyClassification: PrivacyClassification;
}
