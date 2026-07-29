export * from './core/domain/index.js';
export * from './core/ports/index.js';
export type { RiskClass } from './core/routing/risk-class.js';
export type { TaskProfile } from './core/routing/task-profile.js';
export type { ToolProfile } from './core/routing/tool-profile.js';
export type { RouteResolverPort } from './core/routing/route-resolver.port.js';
export { executeMemoryWrite } from './core/application/memory-write.service.js';
export type {
  MemoryWriteCommand,
  MemoryWriteDeps,
  MemoryWriteFailure,
  MemoryWriteOutcome,
} from './core/application/memory-write.service.js';
export { createMemoryAccessGateway } from './core/application/memory-access.gateway.js';
export type {
  ChannelAuthenticationPort,
  MemoryAccessGateway,
  MemoryAccessGatewayDeps,
  MemoryAccessGatewayFailure,
} from './core/application/memory-access.gateway.js';
export { computePayloadDigest } from './core/application/payload-digest.js';
export { executeExtensionRegistration } from './core/application/extension-registration.service.js';
export type {
  ExtensionRegistrationDeps,
  ExtensionRegistrationFailure,
  ExtensionRegistrationOutcome,
} from './core/application/extension-registration.service.js';
export {
  computeManifestDigest,
  executeExtensionActivation,
} from './core/application/extension-activation.service.js';
export type {
  ExtensionActivationCommand,
  ExtensionActivationDeps,
  ExtensionActivationFailure,
  ExtensionActivationOutcome,
} from './core/application/extension-activation.service.js';
export { createExtensionActivationGateway } from './core/application/extension-activation.gateway.js';
export type {
  ExtensionActivationGateway,
  ExtensionActivationGatewayDeps,
  ExtensionActivationGatewayFailure,
  ExtensionActivationGatewayRequest,
} from './core/application/extension-activation.gateway.js';
export { createExtensionPermissionGateway } from './core/application/extension-permission.gateway.js';
export type {
  ExtensionPermissionGateway,
  ExtensionPermissionGatewayDeps,
  ExtensionPermissionGatewayFailure,
  ExtensionPermissionGatewayOutcome,
  ExtensionPermissionResolveRequest,
} from './core/application/extension-permission.gateway.js';
export { createVoiceResolutionGateway } from './core/application/voice-resolution.gateway.js';
export type {
  VoiceResolutionGateway,
  VoiceResolutionGatewayDeps,
  VoiceResolutionOutcome,
  VoiceResolutionRequest,
} from './core/application/voice-resolution.gateway.js';
export { executeWebhookIngress } from './core/application/webhook-ingress.service.js';
export type {
  WebhookIngressDeps,
  WebhookIngressFailure,
  WebhookIngressOutcome,
} from './core/application/webhook-ingress.service.js';
export { resolveExtensionPermissions } from './core/policy/extension-permissions.js';
export {
  authorizeWebhookIngress,
  validateWebhookEnvelope,
  validateWebhookIngressLimits,
} from './core/policy/webhook-ingress.js';
export type { WebhookIngressLimits } from './core/domain/webhook.js';
export {
  resolveVoiceAvailability,
  validateVoiceProfile,
  validateVoiceProviderMatch,
} from './core/policy/voice-profile.js';
export type {
  VoiceProfileValidation,
  VoiceProviderValidation,
} from './core/policy/voice-profile.js';
export {
  resolveEffectiveExtensionRisk,
  requiredApprovalEffectFor,
  PERMISSION_APPROVAL_EFFECT_MAP,
} from './core/domain/extension-risk.js';
export {
  parseMessageId,
  parseCorrelationId,
  parseOwnerId,
  parseActorId,
  parseExtensionId,
  parseExtensionVersion,
  parsePolicyVersion,
  parseManifestDigest,
  parsePayloadDigest,
  parseEventId,
  parseIdempotencyKey,
  parseProviderReference,
  parseSessionId,
  parseChannelId,
  parseSourceId,
  parseDeploymentIdentity,
  parseApprovalId,
  parseNonce,
  parseApprovalNonce,
  parseMemoryRecordId,
  parseResourceRef,
  parseJobId,
  parseReminderId,
  parseScheduledJobId,
  parseISO8601,
} from './core/domain/identity.js';
export type {
  IdentityFailure,
  IdentityFailureCode,
  ExtensionId,
  ExtensionVersion,
  PolicyVersion,
  ManifestDigest,
  EventId,
  ProviderReference,
  SessionId,
  ChannelId,
  SourceId,
  DeploymentIdentity,
  Nonce,
} from './core/domain/identity.js';
export {
  parseModelRoutingConfig,
  parseMemoryNamespacesConfig,
  parseMemoryClassificationConfig,
  parseSecurityPolicyConfig,
  parseOpenClawDraftConfig,
  parseOpenClawPolicyDraftConfig,
  parseAutomationNotificationPolicyDraft,
  parseAutomationQuotasDraft,
  parseAutomationRemindersDraft,
  parseAutomationSubscriptionsDraft,
  parseMediaCapabilitiesDraft,
  parseMediaLimitsDraft,
  parseMemoryRetentionDraft,
  parsePolicyRecipientsDraft,
  parsePolicyRetentionDraft,
  CONFIG_JSON_INVENTORY,
  SECURITY_SENSITIVE_CONFIG_ALLOWLIST,
} from './core/config/index.js';
export type {
  ConfigFailure,
  ModelRoutingConfig,
  MemoryNamespacesConfig,
  MemoryClassificationConfig,
  SecurityPolicyConfig,
  OpenClawDraftConfig,
  OpenClawPolicyDraftConfig,
  ExactDraftConfig,
  ExactDraftKind,
  ConfigInventoryEntry,
  ConfigValidatorKind,
} from './core/config/index.js';
export {
  evaluateNodeSupport,
  parseNodeVersion,
  resolveReviewOverrideAllowed,
  PRODUCTION_NODE_RANGE,
  REVIEW_NODE_OVERRIDE_ENV,
  PRODUCTION_NODE_GATE_ENV,
} from './core/runtime/node-support.js';
export type { NodeSupportDecision } from './core/runtime/node-support.js';
export type { WebhookReplayCheckOutcome } from './core/domain/webhook.js';
