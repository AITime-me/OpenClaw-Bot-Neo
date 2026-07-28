import type { IdempotencyKey, JobId, MessageId, OwnerId, ISO8601 } from './identity.js';
import type { MediaKind } from './media-kind.js';
import type { PrivacyClassification } from './privacy.js';
export type MediaJobStatus =
  | 'queued'
  | 'validating'
  | 'processing'
  | 'awaiting-approval'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired';
export type CleanupStatus = 'pending' | 'completed' | 'failed';
export interface MediaJob {
  readonly jobId: JobId;
  readonly ownerId: OwnerId;
  readonly sourceChannel: string;
  readonly sourceMessageId: MessageId;
  readonly mediaType: MediaKind;
  readonly status: MediaJobStatus;
  readonly progress: number;
  readonly createdAt: ISO8601;
  readonly updatedAt: ISO8601;
  readonly expiresAt: ISO8601;
  readonly retryCount: number;
  readonly idempotencyKey: IdempotencyKey;
  readonly cancellationToken: string;
  readonly provider: string;
  readonly privacyClassification: PrivacyClassification;
  readonly cleanupStatus: CleanupStatus;
  readonly errorCode: string | null;
}
