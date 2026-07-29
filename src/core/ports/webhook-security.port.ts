import type {
  DomainError,
  Result,
  SafeWebhookAuditEvent,
  WebhookEnvelope,
  WebhookReplayCheckOutcome,
  WebhookSignatureVerificationResult,
} from '../domain/index.js';
import type { OperationContext } from './operation-context.js';

export interface WebhookSourceAuthenticationPort {
  authenticate(
    envelope: WebhookEnvelope,
    context: OperationContext,
  ): Promise<Result<boolean, DomainError>>;
}

/**
 * Signature verification receives a disposable byte copy. It returns an untrusted primitive
 * result — never core-branded evidence. Core seals evidence after validating the result.
 */
export interface WebhookSignatureVerificationPort {
  verify(
    envelope: WebhookEnvelope,
    disposablePayloadBytes: Uint8Array,
    payloadDigest: string,
    context: OperationContext,
  ): Promise<Result<WebhookSignatureVerificationResult | null, DomainError>>;
}

export interface WebhookReplayProtectionPort {
  checkAndRecord(
    envelope: WebhookEnvelope,
    context: OperationContext,
  ): Promise<Result<WebhookReplayCheckOutcome, DomainError>>;
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
