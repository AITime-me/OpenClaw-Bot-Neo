import { describe, expect, it } from 'vitest';
import { ok } from '../../src/core/domain/result.js';
import { duplicateTransportOperationalFlags } from '../../src/core/communication/domain/communication-errors.js';
import type {
  AcceptConversationTurnOutcome,
  CommunicationTurnLedgerPort,
  CommunicationTurnTransitionOutcome,
  ObserveTransportEventCommand,
  ObserveTransportEventOutcome,
  RecordAuthenticationResultOutcome,
  RecordFactualOutcomeCommand,
  RecordFactualOutcomeResult,
} from '../../src/core/communication/ports/communication-turn-ledger.port.js';
import type {
  CommunicationTurnState,
  ConversationSequence,
  TurnId,
  TurnRevision,
} from '../../src/core/communication/domain/index.js';
import type { OperationContext } from '../../src/core/domain/operation-context.js';
import { asCorrelation, operationContext } from '../support/fixtures.js';
import {
  parseCommunicationIdempotencyKey,
  parseConversationSequence,
  parseTurnId,
  parseTurnRevision,
  parseTransportInstanceId,
} from '../../src/core/communication/domain/index.js';
import { parseISO8601 } from '../../src/core/domain/index.js';
import { sealFreshObservedAdmissionEvidence } from '../../src/core/communication/domain/authenticated-communication-principal.internal.js';

type OutcomeKind<T> = T extends { readonly kind: infer K } ? K : never;

const asRevision = (value: number): TurnRevision => {
  const parsed = parseTurnRevision(value);
  if (!parsed.ok) throw new Error('revision fixture must parse');
  return parsed.value;
};

const asSequence = (value: number): ConversationSequence => {
  const parsed = parseConversationSequence(value);
  if (!parsed.ok) throw new Error('sequence fixture must parse');
  return parsed.value;
};

interface FakeTurnEntry {
  turnId: TurnId;
  state: CommunicationTurnState;
  conversationSequence: ConversationSequence | null;
  deliveryStatus: 'not_started' | 'started' | 'delivered' | 'failed' | 'outcome_unknown';
  turnRevision: TurnRevision;
}

/**
 * Minimal in-memory ledger contract fake for behavioral assertions only.
 * Not a production or SQLite implementation.
 */
const createFakeTurnLedger = (): CommunicationTurnLedgerPort => {
  const admitted = new Map<string, FakeTurnEntry>();
  let nextSequence = 1;

  return {
    observeTransportEvent(
      command: ObserveTransportEventCommand,
      _operationContext: OperationContext,
    ) {
      void _operationContext;
      const existing = admitted.get(command.idempotencyKey);
      if (existing !== undefined) {
        const outcome: ObserveTransportEventOutcome = {
          kind: 'duplicate-existing',
          turnId: existing.turnId,
          state: existing.state,
          flags: duplicateTransportOperationalFlags(),
        };
        return Promise.resolve(ok(outcome));
      }
      admitted.set(command.idempotencyKey, {
        turnId: command.turnId,
        state: 'observed',
        conversationSequence: null,
        deliveryStatus: 'not_started',
        turnRevision: asRevision(1),
      });
      return Promise.resolve(
        ok({
          kind: 'fresh-observed',
          turnId: command.turnId,
          turnRevision: asRevision(1),
          admissionEvidence: sealFreshObservedAdmissionEvidence(command.turnId),
        }),
      );
    },

    recordAuthenticationResult() {
      return Promise.resolve(ok({ kind: 'recorded', turnRevision: asRevision(2) }));
    },

    acceptConversationTurn(command) {
      for (const entry of admitted.values()) {
        if (entry.turnId !== command.turnId) continue;
        if (entry.conversationSequence !== null) {
          const outcome: AcceptConversationTurnOutcome = {
            kind: 'already-accepted',
            conversationSequence: entry.conversationSequence,
          };
          return Promise.resolve(ok(outcome));
        }
        const sequence = asSequence(nextSequence);
        nextSequence += 1;
        entry.conversationSequence = sequence;
        entry.state = 'accepted';
        entry.turnRevision = asRevision(3);
        return Promise.resolve(
          ok({
            kind: 'accepted',
            conversationSequence: sequence,
            turnRevision: entry.turnRevision,
          }),
        );
      }
      return Promise.resolve(ok({ kind: 'unavailable', reason: 'turn missing' }));
    },

    transition() {
      const outcome: CommunicationTurnTransitionOutcome = {
        kind: 'transitioned',
        turnRevision: asRevision(4),
      };
      return Promise.resolve(ok(outcome));
    },

    recordFactualOutcome(
      command: RecordFactualOutcomeCommand,
      _operationContext: OperationContext,
    ) {
      void _operationContext;
      for (const entry of admitted.values()) {
        if (entry.turnId !== command.turnId) continue;
        if (entry.deliveryStatus === 'delivered' && command.deliveryStatus !== 'delivered') {
          const denied: RecordFactualOutcomeResult = {
            kind: 'fact-rewrite-denied',
            reason: 'Delivered fact cannot be rewritten.',
          };
          return Promise.resolve(ok(denied));
        }
        entry.deliveryStatus = command.deliveryStatus;
        entry.turnRevision = asRevision(Number(entry.turnRevision) + 1);
        return Promise.resolve(ok({ kind: 'recorded', turnRevision: entry.turnRevision }));
      }
      return Promise.resolve(ok({ kind: 'unavailable', reason: 'turn missing' }));
    },

    listRecoveryCandidates() {
      return Promise.resolve(ok({ kind: 'found', candidates: [] }));
    },
  };
};

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

describe('CommunicationTurnLedgerPort behavioral duplicate and delivered facts', () => {
  const observeFixtures = () => {
    const turnId = parseTurnId('turn-ledger-1');
    const transportInstanceId = parseTransportInstanceId('transport-1');
    const idempotencyKey = parseCommunicationIdempotencyKey(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
    const observedAt = parseISO8601('2026-07-01T12:00:00.000Z');
    if (!turnId.ok || !transportInstanceId.ok || !idempotencyKey.ok || !observedAt.ok) {
      throw new Error('observe fixtures must parse');
    }
    return {
      turnId: turnId.value,
      transportInstanceId: transportInstanceId.value,
      idempotencyKey: idempotencyKey.value,
      observedAt: observedAt.value,
    };
  };

  it('returns duplicate-existing with operational stop flags and no new queue position', async () => {
    const ledger = createFakeTurnLedger();
    const fixtures = observeFixtures();
    const context = operationContext();
    const first = await ledger.observeTransportEvent(fixtures, context);
    expect(first.ok).toBe(true);
    if (!first.ok || first.value.kind !== 'fresh-observed') return;

    const accepted = await ledger.acceptConversationTurn(
      {
        turnId: fixtures.turnId,
        expectedRevision: first.value.turnRevision,
        correlationId: asCorrelation(),
      },
      context,
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok || accepted.value.kind !== 'accepted') return;
    const assignedSequence = accepted.value.conversationSequence;

    const duplicate = await ledger.observeTransportEvent(fixtures, context);
    expect(duplicate.ok).toBe(true);
    if (!duplicate.ok || duplicate.value.kind !== 'duplicate-existing') return;
    expect(duplicate.value.turnId).toBe(fixtures.turnId);
    expect(duplicate.value.flags.llmMustNotRun).toBe(true);
    expect(duplicate.value.flags.deliveryMustNotRun).toBe(true);
    expect(duplicate.value.flags.newQueuePositionMustNotBeAssigned).toBe(true);

    const reaccept = await ledger.acceptConversationTurn(
      {
        turnId: fixtures.turnId,
        expectedRevision: accepted.value.turnRevision,
        correlationId: asCorrelation(),
      },
      context,
    );
    expect(reaccept.ok).toBe(true);
    if (!reaccept.ok) return;
    expect(reaccept.value.kind).toBe('already-accepted');
    if (reaccept.value.kind !== 'already-accepted') return;
    expect(reaccept.value.conversationSequence).toBe(assignedSequence);
  });

  it('denies rewriting a delivered fact through a later factual outcome update', async () => {
    const ledger = createFakeTurnLedger();
    const fixtures = observeFixtures();
    const context = operationContext();
    const first = await ledger.observeTransportEvent(fixtures, context);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const delivered = await ledger.recordFactualOutcome(
      {
        turnId: fixtures.turnId,
        correlationId: asCorrelation(),
        expectedRevision: asRevision(1),
        llmOutcome: 'completed',
        deliveryStatus: 'delivered',
        checkpointStatus: 'succeeded',
        auditStatus: { start: 'succeeded', completion: 'succeeded' },
        errorCode: null,
      },
      context,
    );
    expect(delivered.ok).toBe(true);
    if (!delivered.ok || delivered.value.kind !== 'recorded') return;

    const rewrite = await ledger.recordFactualOutcome(
      {
        turnId: fixtures.turnId,
        correlationId: asCorrelation(),
        expectedRevision: delivered.value.turnRevision,
        llmOutcome: 'completed',
        deliveryStatus: 'failed',
        checkpointStatus: 'succeeded',
        auditStatus: { start: 'succeeded', completion: 'succeeded' },
        errorCode: 'DELIVERY_FAILED',
      },
      context,
    );
    expect(rewrite.ok).toBe(true);
    if (!rewrite.ok) return;
    expect(rewrite.value.kind).toBe('fact-rewrite-denied');
    if (rewrite.value.kind !== 'fact-rewrite-denied') return;
    expect(rewrite.value.reason).toMatch(/delivered/i);
  });
});
