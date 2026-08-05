import { ok } from '../../core/domain/result.js';
import type { OperationContext } from '../../core/domain/operation-context.js';
import type { CommunicationKillSwitchPort } from '../../core/communication/ports/communication-kill-switch.port.js';
import type { UntrustedCommunicationKillSwitchObservation } from '../../core/communication/ports/communication-kill-switch.port.js';

export const createReferenceKillSwitch = (
  overrides: Partial<UntrustedCommunicationKillSwitchObservation> = {},
): CommunicationKillSwitchPort & {
  setOverrides: (next: Partial<UntrustedCommunicationKillSwitchObservation>) => void;
} => {
  let current = { ...overrides };
  const base = (): UntrustedCommunicationKillSwitchObservation =>
    Object.freeze({
      communicationEnabled: true,
      llmEnabled: true,
      deliveryEnabled: true,
      auditAvailable: true,
      ledgerAvailable: true,
      scannerAvailable: true,
      conversationStateRequired: true,
      conversationStateAvailable: true,
      configValid: true,
      encryptionLiveGateSatisfied: true,
      offlineOnly: true,
      providerRouteAllowed: false,
      telegramRouteAllowed: false,
      ...current,
    });
  return {
    setOverrides(next) {
      current = { ...current, ...next };
    },
    readSnapshot(_operationContext: OperationContext) {
      void _operationContext;
      return Promise.resolve(ok(base()));
    },
  };
};
