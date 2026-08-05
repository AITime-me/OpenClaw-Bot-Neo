import type { ISO8601, OwnerId } from '../../domain/identity.js';
import type { AuthenticatedCommunicationPrincipal } from './authenticated-communication-principal.js';
import type {
  CommunicationBindingVersion,
  ConversationId,
  TransportInstanceId,
  TurnId,
} from './communication-identity.js';
import {
  getAuthenticatedCommunicationPrincipalCanonical,
  isAuthenticatedCommunicationPrincipal,
} from './authenticated-communication-principal.internal.js';

/**
 * Persistence-only facade for authenticated communication principal claims (Build 3.7C0).
 *
 * Exact export surface only. Allowed importer (exact):
 * host/storage/sqlite/communication/create-offline-sqlite-communication-ports.ts
 *
 * Does not export issuer, sealer, registries, canonical getters, actorId, or original verifiers.
 */

/** Minimal durable claims — not authority and not a principal capability. */
export interface AuthenticatedCommunicationPrincipalPersistenceClaims {
  readonly turnId: TurnId;
  readonly ownerId: OwnerId;
  readonly conversationId: ConversationId;
  readonly transportInstanceId: TransportInstanceId;
  readonly bindingVersion: CommunicationBindingVersion;
  readonly observedAt: ISO8601;
}

export const readAuthenticatedCommunicationPrincipalPersistenceClaims = (
  principal: AuthenticatedCommunicationPrincipal,
): AuthenticatedCommunicationPrincipalPersistenceClaims | null => {
  if (!isAuthenticatedCommunicationPrincipal(principal)) return null;
  const canonical = getAuthenticatedCommunicationPrincipalCanonical(principal);
  if (canonical === null) return null;
  return Object.freeze({
    turnId: canonical.turnId,
    ownerId: canonical.ownerId,
    conversationId: canonical.conversationId,
    transportInstanceId: canonical.transportInstanceId,
    bindingVersion: canonical.bindingVersion,
    observedAt: canonical.observedAt,
  });
};
