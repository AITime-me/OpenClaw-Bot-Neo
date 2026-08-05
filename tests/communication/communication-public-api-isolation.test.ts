import { describe, expect, it } from 'vitest';
import * as publicApi from '../../src/index.js';

const forbiddenCommunicationExports = [
  'parseTransportTextObservation',
  'assembleTextPrompt',
  'authorizeCommunicationMemoryRead',
  'evaluateCommunicationKillSwitchSnapshot',
  'issueAuthenticatedCommunicationPrincipal',
  'sealFreshObservedAdmissionEvidence',
  'sealValidatedTextOutput',
  'isAuthenticatedCommunicationPrincipal',
  'isValidatedTextOutput',
  'deriveCommunicationIdempotencyKey',
  'LEGAL_TRANSITIONS',
  'COMMUNICATION_TURN_STATES',
] as const;

describe('communication public API isolation', () => {
  it('does not export communication domain, policy, or port symbols from the package root', () => {
    const exported = Object.keys(publicApi);
    for (const name of forbiddenCommunicationExports) {
      expect(exported).not.toContain(name);
    }
    expect(exported.some((name) => /communication/i.test(name))).toBe(false);
    expect(exported.some((name) => /TextPrompt/i.test(name))).toBe(false);
    expect(exported.some((name) => /CommunicationPrincipal/i.test(name))).toBe(false);
  });
});
