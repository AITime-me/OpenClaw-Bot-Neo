import type { ISO8601, OwnerId } from './identity.js';
export interface MemoryProvenance {
  readonly capturedAt: ISO8601;
  readonly initiatedBy: OwnerId;
  readonly transformation: string;
  readonly ownerApproved: boolean;
  readonly crossProjectAccess: boolean;
}
