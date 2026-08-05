import type { TurnId } from './communication-identity.js';
import type { FreshObservedAdmissionEvidence } from './authenticated-communication-principal.js';
import { sealFreshObservedAdmissionEvidence } from './authenticated-communication-principal.internal.js';

/**
 * Persistence-only facade for fresh observed admission evidence (Build 3.7C0).
 *
 * Exact export surface only. Allowed importer (exact):
 * host/storage/sqlite/communication/create-offline-sqlite-communication-ports.ts
 *
 * Does not re-export original internals, issuer, registries, or canonical getters.
 */
export const sealFreshObservedAdmissionEvidenceForPersistence = (
  turnId: TurnId,
): FreshObservedAdmissionEvidence => sealFreshObservedAdmissionEvidence(turnId);
