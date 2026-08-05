import type { OperationContext } from '../../domain/operation-context.js';
import type { Result } from '../../domain/result.js';

/** Untrusted kill-switch observation from configuration boundary. */
export interface UntrustedCommunicationKillSwitchObservation {
  readonly communicationEnabled: unknown;
  readonly llmEnabled: unknown;
  readonly deliveryEnabled: unknown;
  readonly auditAvailable: unknown;
  readonly ledgerAvailable: unknown;
  readonly scannerAvailable: unknown;
  readonly conversationStateRequired: unknown;
  readonly conversationStateAvailable: unknown;
  readonly configValid: unknown;
  readonly encryptionLiveGateSatisfied: unknown;
  readonly offlineOnly: unknown;
  readonly providerRouteAllowed: unknown;
  readonly telegramRouteAllowed: unknown;
}

export type CommunicationKillSwitchReadFailureCode = 'UNAVAILABLE' | 'MALFORMED';

export interface CommunicationKillSwitchReadFailure {
  readonly code: CommunicationKillSwitchReadFailureCode;
  readonly reason: string;
}

export interface CommunicationKillSwitchPort {
  readSnapshot(
    operationContext: OperationContext,
  ): Promise<
    Result<UntrustedCommunicationKillSwitchObservation, CommunicationKillSwitchReadFailure>
  >;
}
