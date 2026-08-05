import { describe, expect, it } from 'vitest';
import {
  applyCommunicationKillSwitchPolicy,
  canonicalizeCommunicationKillSwitchSnapshot,
  evaluateCommunicationKillSwitchSnapshot,
} from '../../src/core/communication/policy/communication-kill-switch-policy.js';

const eligibleObservation = {
  communicationEnabled: true,
  llmEnabled: true,
  deliveryEnabled: true,
  auditAvailable: true,
  ledgerAvailable: true,
  scannerAvailable: true,
  conversationStateRequired: false,
  conversationStateAvailable: true,
  configValid: true,
  encryptionLiveGateSatisfied: true,
  offlineOnly: true,
  providerRouteAllowed: false,
  telegramRouteAllowed: false,
} as const;

describe('communication kill-switch policy', () => {
  it('accepts offline-only snapshots with live routes blocked', () => {
    const canonical = canonicalizeCommunicationKillSwitchSnapshot(eligibleObservation);
    expect(canonical.ok).toBe(true);
    if (!canonical.ok) return;
    const decision = evaluateCommunicationKillSwitchSnapshot(canonical.value);
    expect(decision.kind).toBe('eligible');
  });

  it('denies when communication is disabled', () => {
    const decision = evaluateCommunicationKillSwitchSnapshot({
      ...eligibleObservation,
      communicationEnabled: false,
    });
    expect(decision.kind).toBe('denied');
    if (decision.kind !== 'denied') return;
    expect(decision.code).toBe('COMMUNICATION_DISABLED');
    expect(decision.llmMustNotRun).toBe(true);
    expect(decision.deliveryMustNotRun).toBe(true);
  });

  it('denies live provider or telegram routes', () => {
    const provider = evaluateCommunicationKillSwitchSnapshot({
      ...eligibleObservation,
      providerRouteAllowed: true,
    });
    expect(provider.kind).toBe('denied');
    if (provider.kind !== 'denied') return;
    expect(provider.code).toBe('PROVIDER_ROUTE_BLOCKED');

    const telegram = evaluateCommunicationKillSwitchSnapshot({
      ...eligibleObservation,
      telegramRouteAllowed: true,
    });
    expect(telegram.kind).toBe('denied');
    if (telegram.kind !== 'denied') return;
    expect(telegram.code).toBe('TELEGRAM_ROUTE_BLOCKED');
  });

  it('denies when offlineOnly is false', () => {
    const decision = evaluateCommunicationKillSwitchSnapshot({
      ...eligibleObservation,
      offlineOnly: false,
    });
    expect(decision.kind).toBe('denied');
    if (decision.kind !== 'denied') return;
    expect(decision.code).toBe('CONFIG_INVALID');
  });

  it('parses and applies observations end-to-end', () => {
    const applied = applyCommunicationKillSwitchPolicy(eligibleObservation);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.value.kind).toBe('eligible');
  });
});
