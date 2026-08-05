import { describe, expect, it } from 'vitest';
import {
  COMMUNICATION_TURN_STATES,
  LEGAL_TRANSITIONS,
  assertLegalCommunicationTurnTransition,
  canTransitionCommunicationTurnState,
  classifyLlmFailureDisposition,
  llmOutcomeAllowsDeterministicNotice,
  llmOutcomeForbidsDelivery,
  llmOutcomeForbidsDeterministicNotice,
} from '../../src/core/communication/domain/index.js';

describe('communication turn LEGAL_TRANSITIONS', () => {
  it('matches the normative transition table', () => {
    expect(LEGAL_TRANSITIONS.observed).toEqual(['authenticated', 'authentication_rejected']);
    expect(LEGAL_TRANSITIONS.authentication_rejected).toEqual(['completed']);
    expect(LEGAL_TRANSITIONS.authenticated).toEqual(['accepted']);
    expect(LEGAL_TRANSITIONS.accepted).toEqual(['queued']);
    expect(LEGAL_TRANSITIONS.queued).toEqual(['llm_started', 'cancelled']);
    expect(LEGAL_TRANSITIONS.llm_started).toEqual([
      'llm_completed',
      'llm_known_failed',
      'cancelled',
    ]);
    expect(LEGAL_TRANSITIONS.llm_known_failed).toEqual([
      'deterministic_notice_prepared',
      'completed',
    ]);
    expect(LEGAL_TRANSITIONS.deterministic_notice_prepared).toEqual(['output_validated']);
    expect(LEGAL_TRANSITIONS.llm_completed).toEqual(['output_validated']);
    expect(LEGAL_TRANSITIONS.output_validated).toEqual(['delivery_started']);
    expect(LEGAL_TRANSITIONS.delivery_started).toEqual([
      'delivered',
      'delivery_failed',
      'delivery_outcome_unknown',
    ]);
    expect(LEGAL_TRANSITIONS.completed).toEqual([]);
  });

  it('enumerates every declared state in the transition table', () => {
    for (const state of COMMUNICATION_TURN_STATES) {
      expect(LEGAL_TRANSITIONS[state]).toBeDefined();
    }
  });

  it('allows notice preparation only after llm_known_failed', () => {
    expect(
      canTransitionCommunicationTurnState('llm_known_failed', 'deterministic_notice_prepared'),
    ).toBe(true);
    expect(
      canTransitionCommunicationTurnState('llm_started', 'deterministic_notice_prepared'),
    ).toBe(false);
    expect(
      canTransitionCommunicationTurnState('llm_completed', 'deterministic_notice_prepared'),
    ).toBe(false);
    const asserted = assertLegalCommunicationTurnTransition(
      'llm_known_failed',
      'deterministic_notice_prepared',
    );
    expect(asserted.ok).toBe(true);
  });

  it('allows notice-ineligible known failures to complete without notice or delivery', () => {
    expect(canTransitionCommunicationTurnState('llm_known_failed', 'completed')).toBe(true);
    expect(canTransitionCommunicationTurnState('llm_known_failed', 'delivery_started')).toBe(false);
    expect(canTransitionCommunicationTurnState('llm_known_failed', 'output_validated')).toBe(false);
    const disposition = classifyLlmFailureDisposition('policy-rejected');
    expect(disposition).toEqual({
      kind: 'known-failure-without-notice',
      outcome: 'policy-rejected',
    });
    expect(llmOutcomeAllowsDeterministicNotice('policy-rejected')).toBe(false);
    expect(llmOutcomeForbidsDeterministicNotice('policy-rejected')).toBe(true);
    expect(llmOutcomeForbidsDelivery('policy-rejected')).toBe(true);
    expect(llmOutcomeForbidsDelivery('invalid-response')).toBe(true);
  });

  it('classifies notice-eligible failures and forbids notice for outcome-unknown', () => {
    expect(classifyLlmFailureDisposition('provider-unavailable')).toEqual({
      kind: 'known-failure-with-notice',
      outcome: 'provider-unavailable',
    });
    expect(classifyLlmFailureDisposition('outcome-unknown')).toEqual({
      kind: 'outcome-unknown',
      outcome: 'outcome-unknown',
    });
    expect(llmOutcomeForbidsDeterministicNotice('outcome-unknown')).toBe(true);
    expect(llmOutcomeAllowsDeterministicNotice('outcome-unknown')).toBe(false);
    expect(llmOutcomeAllowsDeterministicNotice('provider-unavailable')).toBe(true);
    expect(llmOutcomeAllowsDeterministicNotice('known-timeout')).toBe(true);
    expect(llmOutcomeForbidsDelivery('outcome-unknown')).toBe(true);
  });
});
