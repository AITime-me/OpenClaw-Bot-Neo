import type { ISO8601 } from '../identity.js';
import type { OwnerId } from '../identity.js';
import { deepFreeze } from '../immutable.js';
import type { EnvironmentDisplayName, EnvironmentId, RegionId } from './identity.js';
import type { EnvironmentKind } from './capabilities.js';
import type { InfrastructureError } from './errors.js';

export interface EnvironmentRecord {
  readonly environmentId: EnvironmentId;
  readonly name: EnvironmentDisplayName;
  readonly kind: EnvironmentKind;
  readonly ownerId: OwnerId;
  readonly regionAffinity: RegionId | null;
  readonly policyProfileReference: string;
  readonly createdAt: ISO8601;
  readonly updatedAt: ISO8601;
}

export const sealEnvironmentRecord = (record: EnvironmentRecord): EnvironmentRecord =>
  deepFreeze({ ...record });

export type EnvironmentRegistrationInput = Omit<EnvironmentRecord, 'createdAt' | 'updatedAt'>;

export type EnvironmentRegistryFailure = InfrastructureError;
