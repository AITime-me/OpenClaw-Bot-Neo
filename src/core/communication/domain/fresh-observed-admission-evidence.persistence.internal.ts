/**
 * Persistence-only facade for fresh observed admission evidence (Build 3.7C0).
 *
 * Allowed importer (exact): host/storage/sqlite/communication/create-offline-sqlite-communication-ports.ts
 * Does not export issuer, registries, or principal canonical getters.
 */
export {
  isFreshObservedAdmissionEvidence,
  sealFreshObservedAdmissionEvidence,
} from './authenticated-communication-principal.internal.js';
