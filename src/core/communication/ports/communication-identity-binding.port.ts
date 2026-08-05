import type { ActorId, OwnerId } from '../../domain/identity.js';
import type { OperationContext } from '../../domain/operation-context.js';
import type { Result } from '../../domain/result.js';
import type { FreshObservedAdmissionEvidence } from '../domain/authenticated-communication-principal.js';
import type {
  CommunicationBindingVersion,
  CommunicationIdempotencyKey,
  ConversationId,
  TransportInstanceId,
} from '../domain/communication-identity.js';
import type { TransportTextObservation } from '../domain/transport-text-observation.js';

export interface CommunicationIdentityBindingRequest {
  readonly observation: TransportTextObservation;
  readonly transportInstanceId: TransportInstanceId;
  readonly bindingVersion: CommunicationBindingVersion;
  readonly idempotencyKey: CommunicationIdempotencyKey;
  readonly admissionEvidence: FreshObservedAdmissionEvidence;
}

export interface CommunicationIdentityBindingResult {
  readonly ownerId: OwnerId;
  readonly actorId: ActorId;
  readonly conversationId: ConversationId;
  readonly transportInstanceId: TransportInstanceId;
  readonly bindingVersion: CommunicationBindingVersion;
}

export type CommunicationIdentityBindingResolution =
  | {
      readonly kind: 'bound';
      readonly binding: CommunicationIdentityBindingResult;
    }
  | {
      readonly kind: 'rejected';
      readonly reason: string;
    }
  | {
      readonly kind: 'unavailable';
      readonly reason: string;
    }
  | {
      readonly kind: 'uncertain';
      readonly reason: string;
    };

/**
 * Resolves owner/conversation binding from validated transport observation.
 * Does not create AuthenticatedCommunicationPrincipal.
 */
export interface CommunicationIdentityBindingPort {
  resolveBinding(
    request: CommunicationIdentityBindingRequest,
    operationContext: OperationContext,
  ): Promise<Result<CommunicationIdentityBindingResolution, never>>;
}
