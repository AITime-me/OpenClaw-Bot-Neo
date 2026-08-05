import type { ActorId, ISO8601, OwnerId } from '../../domain/identity.js';
import type { AuthenticatedCommunicationPrincipal } from './authenticated-communication-principal.js';
import type {
  CommunicationBindingVersion,
  ConversationId,
  TransportInstanceId,
  TurnId,
} from './communication-identity.js';
import {
  getAuthenticatedCommunicationPrincipalCanonical,
  getCommunicationPrincipalRedactedMetadata,
  isAuthenticatedCommunicationPrincipal,
} from './authenticated-communication-principal.internal.js';

/**
 * Persistence-only facade for authenticated communication principal claims (Build 3.7C0).
 *
 * Allowed importer (exact): host/storage/sqlite/communication/create-offline-sqlite-communication-ports.ts
 * Does not export issuer, sealer, registries, or the full canonical getter.
 */

/** Minimal durable claims — not authority and not a principal capability. */
export interface CommunicationPrincipalPersistenceClaims {
  readonly turnId: TurnId;
  readonly ownerId: OwnerId;
  readonly actorId: ActorId;
  readonly conversationId: ConversationId;
  readonly transportInstanceId: TransportInstanceId;
  readonly bindingVersion: CommunicationBindingVersion;
  readonly observedAt: ISO8601;
}

export { isAuthenticatedCommunicationPrincipal, getCommunicationPrincipalRedactedMetadata };

export const readCommunicationPrincipalPersistenceClaims = (
  principal: AuthenticatedCommunicationPrincipal,
): CommunicationPrincipalPersistenceClaims | null => {
  if (!isAuthenticatedCommunicationPrincipal(principal)) return null;
  const canonical = getAuthenticatedCommunicationPrincipalCanonical(principal);
  if (canonical === null) return null;
  return Object.freeze({
    turnId: canonical.turnId,
    ownerId: canonical.ownerId,
    actorId: canonical.actorId,
    conversationId: canonical.conversationId,
    transportInstanceId: canonical.transportInstanceId,
    bindingVersion: canonical.bindingVersion,
    observedAt: canonical.observedAt,
  });
};
