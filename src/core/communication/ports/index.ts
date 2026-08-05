export type {
  CommunicationAuditCompletionEvent,
  CommunicationAuditCompletionFailure,
  CommunicationAuditOperationKind,
  CommunicationAuditPort,
  CommunicationAuditRecordOutcome,
  CommunicationAuditStartEvent,
  CommunicationAuditStartFailure,
} from './communication-audit.port.js';

export type {
  CommunicationDeliveryOutboxLoadPendingOutcome,
  CommunicationDeliveryOutboxPendingEntry,
  CommunicationDeliveryOutboxPendingQuery,
  CommunicationDeliveryOutboxPort,
  CommunicationDeliveryOutboxPutCommand,
  CommunicationDeliveryOutboxPutOutcome,
  CommunicationDeliveryOutboxReconcileCommand,
  CommunicationDeliveryOutboxReconcileOutcome,
  CommunicationDeliveryOutboxReconciliationCandidateOutcome,
  CommunicationDeliveryOutboxReconciliationCandidateQuery,
  CommunicationDeliveryOutboxRecordOutcomeCommand,
  CommunicationDeliveryOutboxRecordOutcomeResult,
  CommunicationDeliveryOutcomeKind,
} from './communication-delivery-outbox.port.js';

export type { CommunicationIdGeneratorPort } from './communication-id-generator.port.js';

export type {
  CommunicationIdentityBindingPort,
  CommunicationIdentityBindingRequest,
  CommunicationIdentityBindingResolution,
  CommunicationIdentityBindingResult,
} from './communication-identity-binding.port.js';

export type {
  CommunicationKillSwitchPort,
  CommunicationKillSwitchReadFailure,
  CommunicationKillSwitchReadFailureCode,
  UntrustedCommunicationKillSwitchObservation,
} from './communication-kill-switch.port.js';

export type {
  COMMUNICATION_MEMORY_READ_PURPOSE,
  CommunicationMemoryAuthorizationFailure,
  CommunicationMemoryAuthorizationFailureCode,
  CommunicationMemoryAuthorizationPort,
  CommunicationMemoryAuthorizationRequest,
  CommunicationMemoryContext,
  CommunicationMemoryContextBuilderInput,
  CommunicationMemoryExcerpt,
  CommunicationMemoryReadPurpose,
} from './communication-memory-authorization.port.js';

export type {
  AcceptConversationTurnCommand,
  AcceptConversationTurnOutcome,
  CommunicationRecoveryCandidate,
  CommunicationRecoveryCandidateListOutcome,
  CommunicationRecoveryCandidateQuery,
  CommunicationTurnLedgerPort,
  CommunicationTurnTransitionCommand,
  CommunicationTurnTransitionOutcome,
  ObserveTransportEventCommand,
  ObserveTransportEventOutcome,
  RecordAuthenticationResultCommand,
  RecordAuthenticationResultOutcome,
  RecordFactualOutcomeCommand,
  RecordFactualOutcomeResult,
} from './communication-turn-ledger.port.js';

export type {
  ConversationStateCheckpointCommand,
  ConversationStateCheckpointOutcome,
  ConversationStateKey,
  ConversationStateLoadOutcome,
  ConversationStatePort,
  ConversationStateReconcileCheckpointCommand,
  ConversationStateReconcileCheckpointOutcome,
} from './conversation-state.port.js';

export type { LlmCompletionPort } from './llm-completion.port.js';

export type {
  TextDeliveryOutcome,
  TextDeliveryPort,
  TextDeliveryRequest,
} from './text-delivery.port.js';
