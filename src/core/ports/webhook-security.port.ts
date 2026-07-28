import type {
  DomainError,
  Result,
  SafeWebhookAuditEvent,
  WebhookEnvelope,
} from '../domain/index.js';
import type {
  PayloadBoundSignatureEvidence,
  RawWebhookPayloadHandle,
} from '../domain/webhook.internal.js';
import type { OperationContext } from './operation-context.js';

export interface WebhookSourceAuthenticationPort {
  authenticate(
    envelope: WebhookEnvelope,
    context: OperationContext,
  ): Promise<Result<boolean, DomainError>>;
}

/**
 * Signature verification is bound to a sealed raw payload handle and its computed digest.
 * Callers cannot pass an unbound digest as proof.
 */
export interface WebhookSignatureVerificationPort {
  verify(
    envelope: WebhookEnvelope,
    payload: RawWebhookPayloadHandle,
    context: OperationContext,
  ): Promise<Result<PayloadBoundSignatureEvidence | null, DomainError>>;
}

export interface WebhookReplayProtectionPort {
  checkAndRecord(
    envelope: WebhookEnvelope,
    context: OperationContext,
  ): Promise<Result<'accepted' | 'replay' | 'duplicate-event', DomainError>>;
}

export interface WebhookRateLimitPort {
  decide(
    sourceId: string,
    eventType: string,
    context: OperationContext,
  ): Promise<Result<'allow' | 'deny', DomainError>>;
}

export interface WebhookAuditPort {
  record(
    event: SafeWebhookAuditEvent,
    context: OperationContext,
  ): Promise<Result<void, DomainError>>;
}
