import type {
  DomainError,
  Result,
  SafeWebhookAuditEvent,
  WebhookEnvelope,
} from '../domain/index.js';
import type { OperationContext } from './operation-context.js';

export interface WebhookSourceAuthenticationPort {
  authenticate(
    envelope: WebhookEnvelope,
    context: OperationContext,
  ): Promise<Result<boolean, DomainError>>;
}

/**
 * The raw signature and verification secret never enter the core envelope. A future implementation
 * resolves protected evidence from the authenticated ingress boundary using correlation metadata.
 */
export interface WebhookSignatureVerificationPort {
  verify(
    envelope: WebhookEnvelope,
    context: OperationContext,
  ): Promise<Result<boolean, DomainError>>;
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
