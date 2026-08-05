/**
 * Fixed offline communication runtime diagnostics (Build 3.7D).
 * Caller booleans are not encryption or production evidence.
 */

export interface CommunicationRuntimeDiagnostics {
  readonly mode: 'offline-only';
  readonly executableRuntimePresent: true;
  readonly encryptionEnabled: false;
  readonly livePersistenceAllowed: false;
  readonly liveDeliveryAllowed: false;
  readonly automaticResendAvailable: false;
  readonly automaticRetryAvailable: false;
  readonly productionWired: false;
  readonly networkCallsEnabled: false;
  readonly providerIntegrationPresent: false;
  readonly telegramAdapterPresent: false;
  readonly packageRootExported: false;
  readonly failSafeNoResumeRecovery: true;
  readonly sqliteSchemaVersion: 1;
  readonly ingressEnabled: boolean;
  readonly lifecycle: CommunicationRuntimeLifecycle;
}

export type CommunicationRuntimeLifecycle =
  'new' | 'recovering' | 'running' | 'draining' | 'closed' | 'failed';

export const createCommunicationRuntimeDiagnostics = (input: {
  readonly lifecycle: CommunicationRuntimeLifecycle;
  readonly ingressEnabled: boolean;
}): CommunicationRuntimeDiagnostics =>
  Object.freeze({
    mode: 'offline-only',
    executableRuntimePresent: true,
    encryptionEnabled: false,
    livePersistenceAllowed: false,
    liveDeliveryAllowed: false,
    automaticResendAvailable: false,
    automaticRetryAvailable: false,
    productionWired: false,
    networkCallsEnabled: false,
    providerIntegrationPresent: false,
    telegramAdapterPresent: false,
    packageRootExported: false,
    failSafeNoResumeRecovery: true,
    sqliteSchemaVersion: 1,
    ingressEnabled: input.ingressEnabled,
    lifecycle: input.lifecycle,
  });
