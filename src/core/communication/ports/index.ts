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
  CommunicationDeliveryOutboxReadOutcomeQuery,
  CommunicationDeliveryOutboxReadOutcomeResult,
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
  ConversationCheckpointBarrierReason,
  ConversationCheckpointReconcileEligibleFrom,
  ConversationCheckpointReconcileIneligibleStatus,
  ConversationStateCheckpointBarrierCommand,
  ConversationStateCheckpointBarrierOutcome,
  ConversationStateCheckpointCommand,
  ConversationStateCheckpointOutcome,
  ConversationStateKey,
  ConversationStateLoadOutcome,
  ConversationStatePort,
  ConversationStateReconcileCheckpointCommand,
  ConversationStateReconcileCheckpointOutcome,
} from './conversation-state.port.js';
export {
  CONVERSATION_CHECKPOINT_BARRIER_REASONS,
  CONVERSATION_CHECKPOINT_RECONCILE_ELIGIBLE_FROM,
  isConversationCheckpointReconcileEligible,
} from './conversation-state.port.js';

export type {
  CommunicationPersistenceRetentionPolicy,
  OfflineCommunicationPersistenceDiagnostics,
  OfflineSqliteCommunicationPortsFactoryFlags,
  OfflineSqliteCommunicationPortsFactoryObligations,
} from './offline-communication-persistence.contract.js';
export {
  COMMUNICATION_PERSISTENCE_RETENTION_POLICY,
  OFFLINE_COMMUNICATION_PERSISTENCE_DIAGNOSTICS,
  OFFLINE_OUTBOX_MAX_TTL_MS,
  OFFLINE_SQLITE_COMMUNICATION_PORTS_FACTORY_FLAGS,
  OFFLINE_SQLITE_COMMUNICATION_PORTS_FACTORY_MODULE,
  OFFLINE_SQLITE_COMMUNICATION_PORTS_FACTORY_NAME,
} from './offline-communication-persistence.contract.js';

export type { LlmCompletionPort } from './llm-completion.port.js';

export type {
  TextDeliveryOutcome,
  TextDeliveryPort,
  TextDeliveryRequest,
} from './text-delivery.port.js';
