import type { ActorId, ISO8601, OwnerId } from '../../domain/identity.js';
import { deepFreeze } from '../../domain/immutable.js';
import { err, ok, type Result } from '../../domain/result.js';
import type {
  AuthenticatedCommunicationPrincipal,
  CommunicationPrincipalRedactedMetadata,
  FreshObservedAdmissionEvidence,
} from './authenticated-communication-principal.js';
import type {
  CommunicationBindingVersion,
  ConversationId,
  TransportInstanceId,
  TurnId,
} from './communication-identity.js';

export type { FreshObservedAdmissionEvidence };

interface AdmissionEvidenceState {
  readonly turnId: TurnId;
  consumed: boolean;
}

interface AuthenticatedCommunicationPrincipalCanonical {
  readonly turnId: TurnId;
  readonly ownerId: OwnerId;
  readonly actorId: ActorId;
  readonly conversationId: ConversationId;
  readonly transportInstanceId: TransportInstanceId;
  readonly bindingVersion: CommunicationBindingVersion;
  readonly observedAt: ISO8601;
}

const principalRegistry = new WeakMap<object, CommunicationPrincipalRedactedMetadata>();
const principalCanonicalRegistry = new WeakMap<
  object,
  AuthenticatedCommunicationPrincipalCanonical
>();
const admissionEvidenceRegistry = new WeakMap<object, AdmissionEvidenceState>();

const bindPrincipalSerializationGuards = (view: object): void => {
  Object.defineProperty(view, 'toJSON', {
    value: (): never => {
      throw new TypeError('AuthenticatedCommunicationPrincipal is not serializable.');
    },
    enumerable: false,
    configurable: false,
    writable: false,
  });
};

const createAuthenticatedCommunicationPrincipalShell = (): AuthenticatedCommunicationPrincipal => {
  const view = Object.create(null) as AuthenticatedCommunicationPrincipal;
  bindPrincipalSerializationGuards(view);
  return Object.freeze(view);
};

export const isAuthenticatedCommunicationPrincipal = (
  value: unknown,
): value is AuthenticatedCommunicationPrincipal =>
  typeof value === 'object' && value !== null && principalRegistry.has(value);

export const getCommunicationPrincipalRedactedMetadata = (
  value: AuthenticatedCommunicationPrincipal,
): CommunicationPrincipalRedactedMetadata | null => principalRegistry.get(value) ?? null;

/** Principal equality is object identity only. */
export const communicationPrincipalsEqual = (
  left: AuthenticatedCommunicationPrincipal,
  right: AuthenticatedCommunicationPrincipal,
): boolean => left === right;

export type PrincipalIssuanceFailureCode =
  'ADMISSION_EVIDENCE_INVALID' | 'ADMISSION_EVIDENCE_ALREADY_CONSUMED' | 'BINDING_MISMATCH';

export interface PrincipalIssuanceFailure {
  readonly code: PrincipalIssuanceFailureCode;
  readonly reason: string;
}

/** Seals fresh observed admission evidence for a single turn. Ledger boundary only. */
export const sealFreshObservedAdmissionEvidence = (
  turnId: TurnId,
): FreshObservedAdmissionEvidence => {
  const view = deepFreeze({ kind: 'fresh-observed-admission-evidence' as const });
  admissionEvidenceRegistry.set(view, { turnId, consumed: false });
  return view;
};

export const isFreshObservedAdmissionEvidence = (
  value: unknown,
): value is FreshObservedAdmissionEvidence =>
  typeof value === 'object' && value !== null && admissionEvidenceRegistry.has(value);

const consumeAdmissionEvidence = (
  evidence: FreshObservedAdmissionEvidence,
  expectedTurnId: TurnId,
): Result<AdmissionEvidenceState, PrincipalIssuanceFailure> => {
  const state = admissionEvidenceRegistry.get(evidence);
  if (state === undefined)
    return err({
      code: 'ADMISSION_EVIDENCE_INVALID',
      reason: 'Fresh observed admission evidence is not registered.',
    });
  if (state.consumed)
    return err({
      code: 'ADMISSION_EVIDENCE_ALREADY_CONSUMED',
      reason: 'Fresh observed admission evidence was already consumed.',
    });
  if (state.turnId !== expectedTurnId)
    return err({
      code: 'BINDING_MISMATCH',
      reason: 'Fresh observed admission evidence does not match the requested turn.',
    });
  state.consumed = true;
  return ok(state);
};

/**
 * Issues an opaque communication principal after owner/conversation binding succeeds.
 * Requires genuine, unconsumed fresh observed admission evidence.
 */
export const issueAuthenticatedCommunicationPrincipal = (input: {
  readonly turnId: TurnId;
  readonly ownerId: OwnerId;
  readonly actorId: ActorId;
  readonly conversationId: ConversationId;
  readonly transportInstanceId: TransportInstanceId;
  readonly bindingVersion: CommunicationBindingVersion;
  readonly observedAt: ISO8601;
  readonly admissionEvidence: FreshObservedAdmissionEvidence;
}): Result<AuthenticatedCommunicationPrincipal, PrincipalIssuanceFailure> => {
  const consumed = consumeAdmissionEvidence(input.admissionEvidence, input.turnId);
  if (!consumed.ok) return consumed;

  const metadata: CommunicationPrincipalRedactedMetadata = deepFreeze({
    kind: 'authenticated-communication-principal',
    bindingVersion: input.bindingVersion,
  });
  const shell = createAuthenticatedCommunicationPrincipalShell();
  principalRegistry.set(shell, metadata);
  principalCanonicalRegistry.set(
    shell,
    deepFreeze({
      turnId: input.turnId,
      ownerId: input.ownerId,
      actorId: input.actorId,
      conversationId: input.conversationId,
      transportInstanceId: input.transportInstanceId,
      bindingVersion: input.bindingVersion,
      observedAt: input.observedAt,
    }),
  );
  return ok(shell);
};

export const getAuthenticatedCommunicationPrincipalCanonical = (
  principal: AuthenticatedCommunicationPrincipal,
): AuthenticatedCommunicationPrincipalCanonical | null => {
  if (getCommunicationPrincipalRedactedMetadata(principal) === null) return null;
  return principalCanonicalRegistry.get(principal) ?? null;
};

export type { AuthenticatedCommunicationPrincipalCanonical };
