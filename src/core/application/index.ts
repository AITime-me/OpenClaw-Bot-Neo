export { computePayloadDigest } from './payload-digest.js';
export { executeMemoryWrite } from './memory-write.service.js';
export type {
  MemoryWriteCommand,
  MemoryWriteDeps,
  MemoryWriteFailure,
  MemoryWriteOutcome,
} from './memory-write.service.js';
export { createMemoryAccessGateway } from './memory-access.gateway.js';
export type {
  ChannelAuthenticationPort,
  MemoryAccessGateway,
  MemoryAccessGatewayDeps,
  MemoryAccessGatewayFailure,
} from './memory-access.gateway.js';
export { executeExtensionRegistration } from './extension-registration.service.js';
export type {
  ExtensionRegistrationDeps,
  ExtensionRegistrationFailure,
  ExtensionRegistrationOutcome,
} from './extension-registration.service.js';
export {
  computeManifestDigest,
  executeExtensionActivation,
} from './extension-activation.service.js';
export type {
  ExtensionActivationCommand,
  ExtensionActivationDeps,
  ExtensionActivationFailure,
  ExtensionActivationOutcome,
} from './extension-activation.service.js';
export { createExtensionActivationGateway } from './extension-activation.gateway.js';
export type {
  ExtensionActivationGateway,
  ExtensionActivationGatewayDeps,
  ExtensionActivationGatewayFailure,
  ExtensionActivationGatewayRequest,
} from './extension-activation.gateway.js';
export type {
  RuntimeRiskClassificationDeps,
  RuntimeRiskClassificationFailure,
  RuntimeRiskOperationRequest,
} from './runtime-risk-classification.service.js';
export { createExtensionPermissionGateway } from './extension-permission.gateway.js';
export type {
  ExtensionPermissionGateway,
  ExtensionPermissionGatewayDeps,
  ExtensionPermissionGatewayFailure,
  ExtensionPermissionGatewayOutcome,
  ExtensionPermissionResolveRequest,
} from './extension-permission.gateway.js';
export { createVoiceResolutionGateway } from './voice-resolution.gateway.js';
export type {
  VoiceResolutionGateway,
  VoiceResolutionGatewayDeps,
  VoiceResolutionOutcome,
  VoiceResolutionRequest,
} from './voice-resolution.gateway.js';
export { executeWebhookIngress } from './webhook-ingress.service.js';
export type {
  WebhookIngressDeps,
  WebhookIngressFailure,
  WebhookIngressOutcome,
} from './webhook-ingress.service.js';
