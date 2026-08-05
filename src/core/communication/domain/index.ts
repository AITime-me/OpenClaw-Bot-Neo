export type {
  ActorId,
  CommunicationBindingVersion,
  CommunicationIdempotencyKey,
  ConversationId,
  ConversationRevision,
  ConversationSequence,
  CorrelationId,
  ExternalTransportConversationReference,
  ExternalTransportInstanceReference,
  ExternalTransportMessageReference,
  ExternalTransportSenderReference,
  ISO8601,
  OwnerId,
  PayloadDigest,
  PolicyVersion,
  TransportInstanceId,
  TurnId,
  TurnRevision,
  UntrustedSourceTimestamp,
} from './communication-identity.js';

export {
  MAX_ACTIVE_CONTEXT_ENTRIES,
  MAX_ACTIVE_CONTEXT_TOTAL_UTF8_BYTES,
  MAX_MEMORY_EXCERPT_COUNT,
  MAX_MEMORY_EXCERPT_UTF8_BYTES,
  MAX_MEMORY_EXCERPTS_TOTAL_UTF8_BYTES,
  MAX_MODEL_OUTPUT_UTF8_BYTES,
  MAX_OWNER_TEXT_UTF8_BYTES,
  MAX_PROMPT_TOTAL_UTF8_BYTES,
  MAX_TRANSPORT_OBSERVATION_TEXT_UTF8_BYTES,
  MIN_MODEL_OUTPUT_UTF8_BYTES,
  computeCommunicationTextDigest,
  deriveCommunicationIdempotencyKey,
  normalizeAndValidateCommunicationText,
  parseCommunicationBindingVersion,
  parseCommunicationIdempotencyKey,
  parseConversationId,
  parseConversationRevision,
  parseConversationSequence,
  parseExternalTransportConversationReference,
  parseExternalTransportInstanceReference,
  parseExternalTransportMessageReference,
  parseExternalTransportSenderReference,
  parseTransportInstanceId,
  parseTurnId,
  parseTurnRevision,
  parseUntrustedSourceTimestamp,
} from './communication-identity.js';

export type {
  CommunicationTextFailure,
  CommunicationTextFailureCode,
} from './communication-identity.js';

export type {
  TransportTextObservation,
  TransportTextObservationFailure,
} from './transport-text-observation.js';
export { parseTransportTextObservation } from './transport-text-observation.js';

export type {
  AuthenticatedCommunicationPrincipal,
  CommunicationPrincipalRedactedMetadata,
  FreshObservedAdmissionEvidence,
} from './authenticated-communication-principal.js';
export {
  communicationPrincipalsEqual,
  getCommunicationPrincipalRedactedMetadata,
  isAuthenticatedCommunicationPrincipal,
} from './authenticated-communication-principal.internal.js';

export type {
  ConversationActiveContextEntry,
  ConversationActiveContextRole,
  ConversationCheckpointMetadata,
  ConversationCheckpointMetadataStatus,
  ConversationContextTrust,
  ConversationModelDerivedSummary,
  ConversationPauseState,
  ConversationStateKey,
  ConversationStateSnapshot,
  ModelDerivedUntrustedTrust,
} from './conversation-state.js';
export {
  MODEL_DERIVED_UNTRUSTED_TRUST,
  conversationStateKeysEqual,
  freezeConversationStateSnapshot,
} from './conversation-state.js';

export type {
  AuditCompletionStatus,
  AuditStartStatus,
  CheckpointStatus,
  CommunicationQueueConfig,
  CommunicationTurnRecord,
  CommunicationTurnState,
  DeliveryStatus,
  TurnAuditStatus,
} from './communication-turn.js';
export {
  AUDIT_COMPLETION_STATUSES,
  AUDIT_START_STATUSES,
  CHECKPOINT_STATUSES,
  COMMUNICATION_TURN_STATES,
  DEFAULT_MAX_DEPTH_PER_CONVERSATION,
  DELIVERY_STATUSES,
  LEGAL_TRANSITIONS,
  MAX_ACTIVE_TURNS_PER_CONVERSATION,
  MAX_MAX_DEPTH_PER_CONVERSATION,
  MAX_MAX_GLOBAL_PENDING,
  MIN_MAX_DEPTH_PER_CONVERSATION,
  MIN_MAX_GLOBAL_PENDING,
  assertLegalCommunicationTurnTransition,
  canTransitionCommunicationTurnState,
  defaultCommunicationQueueConfig,
  initialTurnAuditStatus,
  initialTurnOrthogonalStatuses,
  isCommunicationTurnState,
  parseCommunicationQueueConfig,
} from './communication-turn.js';

export type {
  TextPrompt,
  TextPromptAssemblyInput,
  TextPromptMemoryExcerpt,
  TextPromptSection,
  TextPromptSectionKind,
} from './text-prompt.js';
export {
  TEXT_PROMPT_BOUNDS,
  TEXT_PROMPT_SECTION_KINDS,
  freezeTextPrompt,
  isTextPromptSectionKind,
  textPromptSectionKindsInOrder,
} from './text-prompt.js';

export type {
  LlmCompletionKnownFailure,
  LlmCompletionOutcome,
  LlmCompletionOutcomeUnknown,
  LlmCompletionRequest,
  LlmCompletionResult,
  LlmCompletionSuccess,
  LlmFailureDisposition,
  LlmKnownFailureOutcome,
  LlmNoticeEligibleFailureOutcome,
  LlmNoticeIneligibleFailureOutcome,
} from './llm-completion.js';
export {
  LLM_COMPLETION_OUTCOMES,
  LLM_NOTICE_ELIGIBLE_FAILURE_OUTCOMES,
  LLM_NOTICE_INELIGIBLE_FAILURE_OUTCOMES,
  classifyLlmFailureDisposition,
  isLlmCompletionOutcome,
  isLlmNoticeEligibleFailureOutcome,
  isLlmNoticeIneligibleFailureOutcome,
  llmOutcomeAllowsDeterministicNotice,
  llmOutcomeForbidsAutomaticRetry,
  llmOutcomeForbidsDelivery,
  llmOutcomeForbidsDeterministicNotice,
} from './llm-completion.js';

export type {
  ValidatedTextOutput,
  ValidatedTextOutputSource,
  ValidatedTextOutputView,
} from './text-delivery.js';
export {
  getValidatedTextOutputView,
  isValidatedTextOutput,
  validatedTextOutputsEqual,
} from './text-delivery.internal.js';

export type {
  CommunicationDuplicateTransportFlags,
  CommunicationError,
  CommunicationErrorCode,
  CommunicationOperationalFlags,
} from './communication-errors.js';
export {
  COMMUNICATION_ERROR_CODES,
  auditStartFailureFlags,
  communicationError,
  duplicateTransportOperationalFlags,
  isCommunicationErrorCode,
  outputRejectedFlags,
} from './communication-errors.js';
