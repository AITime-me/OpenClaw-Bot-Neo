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
  issueDeploymentAuthorization,
} from './extension-activation.service.js';
export type {
  DeploymentAuthorizationCommand,
  ExtensionActivationCommand,
  ExtensionActivationDeps,
  ExtensionActivationFailure,
  ExtensionActivationOutcome,
} from './extension-activation.service.js';
export { classifyExtensionRuntimeRisk } from './runtime-risk-classification.service.js';
export type {
  RuntimeRiskClassificationDeps,
  RuntimeRiskClassificationFailure,
} from './runtime-risk-classification.service.js';
export { executeWebhookIngress } from './webhook-ingress.service.js';
export type {
  WebhookIngressDeps,
  WebhookIngressFailure,
  WebhookIngressOutcome,
} from './webhook-ingress.service.js';
