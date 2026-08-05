import { describe, expect, it } from 'vitest';
import {
  COMMUNICATION_TURN_STATES,
  LEGAL_TRANSITIONS,
  assertLegalCommunicationTurnTransition,
  canTransitionCommunicationTurnState,
  llmOutcomeAllowsDeterministicNotice,
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
    expect(LEGAL_TRANSITIONS.llm_known_failed).toEqual(['deterministic_notice_prepared']);
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

  it('forbids deterministic notice for outcome-unknown LLM results', () => {
    expect(llmOutcomeForbidsDeterministicNotice('outcome-unknown')).toBe(true);
    expect(llmOutcomeAllowsDeterministicNotice('outcome-unknown')).toBe(false);
    expect(llmOutcomeAllowsDeterministicNotice('provider-unavailable')).toBe(true);
    expect(llmOutcomeAllowsDeterministicNotice('known-timeout')).toBe(true);
  });
});
