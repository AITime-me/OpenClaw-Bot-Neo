import { describe, expect, it } from 'vitest';
import type {
  AcceptConversationTurnOutcome,
  CommunicationTurnTransitionOutcome,
  ObserveTransportEventOutcome,
  RecordAuthenticationResultOutcome,
  RecordFactualOutcomeResult,
} from '../../src/core/communication/ports/communication-turn-ledger.port.js';

type OutcomeKind<T> = T extends { readonly kind: infer K } ? K : never;

describe('CommunicationTurnLedgerPort outcome unions', () => {
  it('covers observe transport event outcomes', () => {
    const kinds: readonly OutcomeKind<ObserveTransportEventOutcome>[] = [
      'fresh-observed',
      'duplicate-existing',
      'unavailable',
      'concurrency-conflict',
    ];
    expect(kinds).toHaveLength(4);
  });

  it('covers authentication result outcomes', () => {
    const kinds: readonly OutcomeKind<RecordAuthenticationResultOutcome>[] = [
      'recorded',
      'already-recorded',
      'illegal-transition',
      'stale-revision',
      'unavailable',
      'concurrency-conflict',
    ];
    expect(kinds).toHaveLength(6);
  });

  it('covers accept conversation turn outcomes', () => {
    const kinds: readonly OutcomeKind<AcceptConversationTurnOutcome>[] = [
      'accepted',
      'already-accepted',
      'illegal-transition',
      'stale-revision',
      'unavailable',
      'concurrency-conflict',
      'queue-full',
      'global-queue-full',
    ];
    expect(kinds).toHaveLength(8);
  });

  it('covers transition outcomes', () => {
    const kinds: readonly OutcomeKind<CommunicationTurnTransitionOutcome>[] = [
      'transitioned',
      'already-transitioned',
      'illegal-transition',
      'stale-revision',
      'unavailable',
      'concurrency-conflict',
    ];
    expect(kinds).toHaveLength(6);
  });

  it('covers factual outcome recording results', () => {
    const kinds: readonly OutcomeKind<RecordFactualOutcomeResult>[] = [
      'recorded',
      'already-recorded',
      'stale-revision',
      'fact-rewrite-denied',
      'unavailable',
      'concurrency-conflict',
    ];
    expect(kinds).toHaveLength(6);
  });
});
