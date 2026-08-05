import { exactPlainObservation } from '../../domain/observation-validation.js';
import { deepFreeze } from '../../domain/immutable.js';
import { err, ok, type Result } from '../../domain/result.js';
import type { UntrustedCommunicationKillSwitchObservation } from '../ports/communication-kill-switch.port.js';

export const KILL_SWITCH_OBSERVATION_FIELDS = Object.freeze([
  'communicationEnabled',
  'llmEnabled',
  'deliveryEnabled',
  'auditAvailable',
  'ledgerAvailable',
  'scannerAvailable',
  'conversationStateRequired',
  'conversationStateAvailable',
  'configValid',
  'encryptionLiveGateSatisfied',
  'offlineOnly',
  'providerRouteAllowed',
  'telegramRouteAllowed',
] as const);

export type CommunicationKillSwitchDenialCode =
  | 'COMMUNICATION_DISABLED'
  | 'LLM_DISABLED'
  | 'DELIVERY_DISABLED'
  | 'AUDIT_UNAVAILABLE'
  | 'LEDGER_UNAVAILABLE'
  | 'SCANNER_UNAVAILABLE'
  | 'CONVERSATION_STATE_UNAVAILABLE'
  | 'CONFIG_INVALID'
  | 'ENCRYPTION_LIVE_GATE_BLOCKED'
  | 'PROVIDER_ROUTE_BLOCKED'
  | 'TELEGRAM_ROUTE_BLOCKED'
  | 'MALFORMED';

export interface CommunicationKillSwitchSnapshot {
  readonly communicationEnabled: boolean;
  readonly llmEnabled: boolean;
  readonly deliveryEnabled: boolean;
  readonly auditAvailable: boolean;
  readonly ledgerAvailable: boolean;
  readonly scannerAvailable: boolean;
  readonly conversationStateRequired: boolean;
  readonly conversationStateAvailable: boolean;
  readonly configValid: boolean;
  readonly encryptionLiveGateSatisfied: boolean;
  readonly offlineOnly: boolean;
  readonly providerRouteAllowed: boolean;
  readonly telegramRouteAllowed: boolean;
}

export type CommunicationKillSwitchPolicyResult =
  | { readonly kind: 'eligible'; readonly snapshot: CommunicationKillSwitchSnapshot }
  | {
      readonly kind: 'denied';
      readonly code: CommunicationKillSwitchDenialCode;
      readonly llmMustNotRun: true;
      readonly deliveryMustNotRun: boolean;
    };

const parseBooleanField = (
  value: unknown,
  label: string,
): Result<boolean, { readonly code: 'MALFORMED'; readonly reason: string }> => {
  if (typeof value !== 'boolean')
    return err({ code: 'MALFORMED', reason: `${label} must be a boolean.` });
  return ok(value);
};

export const parseCommunicationKillSwitchObservation = (
  input: unknown,
): Result<
  UntrustedCommunicationKillSwitchObservation,
  { readonly code: 'MALFORMED'; readonly reason: string }
> => {
  const plain = exactPlainObservation(input, KILL_SWITCH_OBSERVATION_FIELDS);
  if (plain === null)
    return err({
      code: 'MALFORMED',
      reason: 'Kill-switch observation must be an exact plain object with required fields.',
    });

  const readBoolean = (
    field: (typeof KILL_SWITCH_OBSERVATION_FIELDS)[number],
  ): Result<boolean, { readonly code: 'MALFORMED'; readonly reason: string }> => {
    const value = plain[field];
    if (typeof value !== 'boolean')
      return err({ code: 'MALFORMED', reason: `${field} must be a boolean.` });
    return ok(value);
  };

  const communicationEnabled = readBoolean('communicationEnabled');
  if (!communicationEnabled.ok) return communicationEnabled;
  const llmEnabled = readBoolean('llmEnabled');
  if (!llmEnabled.ok) return llmEnabled;
  const deliveryEnabled = readBoolean('deliveryEnabled');
  if (!deliveryEnabled.ok) return deliveryEnabled;
  const auditAvailable = readBoolean('auditAvailable');
  if (!auditAvailable.ok) return auditAvailable;
  const ledgerAvailable = readBoolean('ledgerAvailable');
  if (!ledgerAvailable.ok) return ledgerAvailable;
  const scannerAvailable = readBoolean('scannerAvailable');
  if (!scannerAvailable.ok) return scannerAvailable;
  const conversationStateRequired = readBoolean('conversationStateRequired');
  if (!conversationStateRequired.ok) return conversationStateRequired;
  const conversationStateAvailable = readBoolean('conversationStateAvailable');
  if (!conversationStateAvailable.ok) return conversationStateAvailable;
  const configValid = readBoolean('configValid');
  if (!configValid.ok) return configValid;
  const encryptionLiveGateSatisfied = readBoolean('encryptionLiveGateSatisfied');
  if (!encryptionLiveGateSatisfied.ok) return encryptionLiveGateSatisfied;
  const offlineOnly = readBoolean('offlineOnly');
  if (!offlineOnly.ok) return offlineOnly;
  const providerRouteAllowed = readBoolean('providerRouteAllowed');
  if (!providerRouteAllowed.ok) return providerRouteAllowed;
  const telegramRouteAllowed = readBoolean('telegramRouteAllowed');
  if (!telegramRouteAllowed.ok) return telegramRouteAllowed;

  return ok({
    communicationEnabled: communicationEnabled.value,
    llmEnabled: llmEnabled.value,
    deliveryEnabled: deliveryEnabled.value,
    auditAvailable: auditAvailable.value,
    ledgerAvailable: ledgerAvailable.value,
    scannerAvailable: scannerAvailable.value,
    conversationStateRequired: conversationStateRequired.value,
    conversationStateAvailable: conversationStateAvailable.value,
    configValid: configValid.value,
    encryptionLiveGateSatisfied: encryptionLiveGateSatisfied.value,
    offlineOnly: offlineOnly.value,
    providerRouteAllowed: providerRouteAllowed.value,
    telegramRouteAllowed: telegramRouteAllowed.value,
  });
};

export const canonicalizeCommunicationKillSwitchSnapshot = (
  observation: UntrustedCommunicationKillSwitchObservation,
): Result<
  CommunicationKillSwitchSnapshot,
  { readonly code: 'MALFORMED'; readonly reason: string }
> => {
  const communicationEnabled = parseBooleanField(
    observation.communicationEnabled,
    'communicationEnabled',
  );
  if (!communicationEnabled.ok) return communicationEnabled;
  const llmEnabled = parseBooleanField(observation.llmEnabled, 'llmEnabled');
  if (!llmEnabled.ok) return llmEnabled;
  const deliveryEnabled = parseBooleanField(observation.deliveryEnabled, 'deliveryEnabled');
  if (!deliveryEnabled.ok) return deliveryEnabled;
  const auditAvailable = parseBooleanField(observation.auditAvailable, 'auditAvailable');
  if (!auditAvailable.ok) return auditAvailable;
  const ledgerAvailable = parseBooleanField(observation.ledgerAvailable, 'ledgerAvailable');
  if (!ledgerAvailable.ok) return ledgerAvailable;
  const scannerAvailable = parseBooleanField(observation.scannerAvailable, 'scannerAvailable');
  if (!scannerAvailable.ok) return scannerAvailable;
  const conversationStateRequired = parseBooleanField(
    observation.conversationStateRequired,
    'conversationStateRequired',
  );
  if (!conversationStateRequired.ok) return conversationStateRequired;
  const conversationStateAvailable = parseBooleanField(
    observation.conversationStateAvailable,
    'conversationStateAvailable',
  );
  if (!conversationStateAvailable.ok) return conversationStateAvailable;
  const configValid = parseBooleanField(observation.configValid, 'configValid');
  if (!configValid.ok) return configValid;
  const encryptionLiveGateSatisfied = parseBooleanField(
    observation.encryptionLiveGateSatisfied,
    'encryptionLiveGateSatisfied',
  );
  if (!encryptionLiveGateSatisfied.ok) return encryptionLiveGateSatisfied;
  const offlineOnly = parseBooleanField(observation.offlineOnly, 'offlineOnly');
  if (!offlineOnly.ok) return offlineOnly;
  const providerRouteAllowed = parseBooleanField(
    observation.providerRouteAllowed,
    'providerRouteAllowed',
  );
  if (!providerRouteAllowed.ok) return providerRouteAllowed;
  const telegramRouteAllowed = parseBooleanField(
    observation.telegramRouteAllowed,
    'telegramRouteAllowed',
  );
  if (!telegramRouteAllowed.ok) return telegramRouteAllowed;

  return ok(
    deepFreeze({
      communicationEnabled: communicationEnabled.value,
      llmEnabled: llmEnabled.value,
      deliveryEnabled: deliveryEnabled.value,
      auditAvailable: auditAvailable.value,
      ledgerAvailable: ledgerAvailable.value,
      scannerAvailable: scannerAvailable.value,
      conversationStateRequired: conversationStateRequired.value,
      conversationStateAvailable: conversationStateAvailable.value,
      configValid: configValid.value,
      encryptionLiveGateSatisfied: encryptionLiveGateSatisfied.value,
      offlineOnly: offlineOnly.value,
      providerRouteAllowed: providerRouteAllowed.value,
      telegramRouteAllowed: telegramRouteAllowed.value,
    }),
  );
};

const deny = (
  code: CommunicationKillSwitchDenialCode,
  deliveryMustNotRun: boolean,
): CommunicationKillSwitchPolicyResult =>
  Object.freeze({
    kind: 'denied',
    code,
    llmMustNotRun: true,
    deliveryMustNotRun,
  });

/**
 * Evaluates a per-turn kill-switch snapshot for Build 3.7B offline contract.
 * Requires offlineOnly=true and live provider/Telegram routes blocked.
 */
export const evaluateCommunicationKillSwitchSnapshot = (
  snapshot: CommunicationKillSwitchSnapshot,
): CommunicationKillSwitchPolicyResult => {
  if (!snapshot.communicationEnabled) return deny('COMMUNICATION_DISABLED', true);
  if (!snapshot.llmEnabled) return deny('LLM_DISABLED', true);
  if (!snapshot.deliveryEnabled) return deny('DELIVERY_DISABLED', true);
  if (!snapshot.auditAvailable) return deny('AUDIT_UNAVAILABLE', true);
  if (!snapshot.ledgerAvailable) return deny('LEDGER_UNAVAILABLE', true);
  if (!snapshot.scannerAvailable) return deny('SCANNER_UNAVAILABLE', true);
  if (snapshot.conversationStateRequired && !snapshot.conversationStateAvailable)
    return deny('CONVERSATION_STATE_UNAVAILABLE', true);
  if (!snapshot.configValid) return deny('CONFIG_INVALID', true);
  if (!snapshot.encryptionLiveGateSatisfied) return deny('ENCRYPTION_LIVE_GATE_BLOCKED', true);
  if (!snapshot.offlineOnly) return deny('CONFIG_INVALID', true);
  if (snapshot.providerRouteAllowed) return deny('PROVIDER_ROUTE_BLOCKED', true);
  if (snapshot.telegramRouteAllowed) return deny('TELEGRAM_ROUTE_BLOCKED', true);

  return Object.freeze({ kind: 'eligible', snapshot });
};

export const applyCommunicationKillSwitchPolicy = (
  observation: unknown,
): Result<
  CommunicationKillSwitchPolicyResult,
  { readonly code: 'MALFORMED'; readonly reason: string }
> => {
  const parsed = parseCommunicationKillSwitchObservation(observation);
  if (!parsed.ok) return parsed;
  const canonical = canonicalizeCommunicationKillSwitchSnapshot(parsed.value);
  if (!canonical.ok) return canonical;
  return ok(evaluateCommunicationKillSwitchSnapshot(canonical.value));
};
