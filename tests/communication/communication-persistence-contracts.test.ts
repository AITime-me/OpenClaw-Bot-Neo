import { describe, expect, it } from 'vitest';
import {
  COMMUNICATION_RECOVERY_CANDIDATE_ORDER,
  COMMUNICATION_TURN_STATES,
  MAX_COMMUNICATION_RECOVERY_LIMIT,
  MAX_COMMUNICATION_RECOVERY_STATE_COUNT,
  MIN_COMMUNICATION_RECOVERY_LIMIT,
  MIN_COMMUNICATION_RECOVERY_STATE_COUNT,
  validateCommunicationRecoveryCandidateQuery,
} from '../../src/core/communication/domain/index.js';
import {
  CONVERSATION_CHECKPOINT_RECONCILE_ELIGIBLE_FROM,
  isConversationCheckpointReconcileEligible,
  COMMUNICATION_PERSISTENCE_RETENTION_POLICY,
  OFFLINE_COMMUNICATION_PERSISTENCE_DIAGNOSTICS,
  OFFLINE_OUTBOX_MAX_TTL_MS,
  OFFLINE_SQLITE_COMMUNICATION_PORTS_FACTORY_FLAGS,
  OFFLINE_SQLITE_COMMUNICATION_PORTS_FACTORY_MODULE,
  OFFLINE_SQLITE_COMMUNICATION_PORTS_FACTORY_NAME,
} from '../../src/core/communication/ports/index.js';
import type { ConversationStateReconcileCheckpointOutcome } from '../../src/core/communication/ports/conversation-state.port.js';

type OutcomeKind<T> = T extends { readonly kind: infer K } ? K : never;

describe('Build 3.7C0 recovery query contract', () => {
  it('keeps turn state count aligned with recovery state bounds', () => {
    expect(COMMUNICATION_TURN_STATES).toHaveLength(MAX_COMMUNICATION_RECOVERY_STATE_COUNT);
    expect(MIN_COMMUNICATION_RECOVERY_STATE_COUNT).toBe(1);
    expect(MIN_COMMUNICATION_RECOVERY_LIMIT).toBe(1);
    expect(MAX_COMMUNICATION_RECOVERY_LIMIT).toBe(100);
    expect(COMMUNICATION_RECOVERY_CANDIDATE_ORDER).toEqual(['updatedAt', 'observedAt', 'turnId']);
  });

  it('accepts a valid recovery query', () => {
    const result = validateCommunicationRecoveryCandidateQuery({
      states: ['accepted', 'queued'],
      limit: 10,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects empty or oversized state lists with CONFIG_INVALID', () => {
    const empty = validateCommunicationRecoveryCandidateQuery({ states: [], limit: 1 });
    expect(empty.ok).toBe(false);
    if (empty.ok) return;
    expect(empty.error.code).toBe('CONFIG_INVALID');

    const oversized = validateCommunicationRecoveryCandidateQuery({
      states: [...COMMUNICATION_TURN_STATES, 'completed'],
      limit: 1,
    });
    expect(oversized.ok).toBe(false);
    if (oversized.ok) return;
    expect(oversized.error.code).toBe('CONFIG_INVALID');
  });

  it('rejects invalid limits and duplicate states with CONFIG_INVALID', () => {
    const low = validateCommunicationRecoveryCandidateQuery({
      states: ['completed'],
      limit: 0,
    });
    expect(low.ok).toBe(false);
    if (low.ok) return;
    expect(low.error.code).toBe('CONFIG_INVALID');

    const high = validateCommunicationRecoveryCandidateQuery({
      states: ['completed'],
      limit: 101,
    });
    expect(high.ok).toBe(false);
    if (high.ok) return;
    expect(high.error.code).toBe('CONFIG_INVALID');

    const duplicates = validateCommunicationRecoveryCandidateQuery({
      states: ['queued', 'queued'],
      limit: 1,
    });
    expect(duplicates.ok).toBe(false);
    if (duplicates.ok) return;
    expect(duplicates.error.code).toBe('CONFIG_INVALID');
  });
});

describe('Build 3.7C0 reconcileCheckpoint contract', () => {
  it('allows only pending and failed as reconcile sources', () => {
    expect(CONVERSATION_CHECKPOINT_RECONCILE_ELIGIBLE_FROM).toEqual(['pending', 'failed']);
    expect(isConversationCheckpointReconcileEligible('pending')).toBe(true);
    expect(isConversationCheckpointReconcileEligible('failed')).toBe(true);
    expect(isConversationCheckpointReconcileEligible('succeeded')).toBe(false);
    expect(isConversationCheckpointReconcileEligible('not_required')).toBe(false);
  });

  it('enumerates the expanded reconcile outcomes', () => {
    const kinds: readonly OutcomeKind<ConversationStateReconcileCheckpointOutcome>[] = [
      'reconciled',
      'already-reconciled',
      'not-found',
      'not-eligible',
      'stale-revision',
      'idempotency-conflict',
      'unavailable',
    ];
    expect(kinds).toHaveLength(7);
  });
});

describe('Build 3.7C0 offline persistence retention and factory contract', () => {
  it('locks retention and diagnostics to indefinite retention with forensicEraseGuaranteed=false', () => {
    expect(COMMUNICATION_PERSISTENCE_RETENTION_POLICY.turnRowsRetainedIndefinitely).toBe(true);
    expect(COMMUNICATION_PERSISTENCE_RETENTION_POLICY.outboxPlaintextMaxTtlMs).toBe(
      OFFLINE_OUTBOX_MAX_TTL_MS,
    );
    expect(OFFLINE_OUTBOX_MAX_TTL_MS).toBe(86_400_000);
    expect(COMMUNICATION_PERSISTENCE_RETENTION_POLICY.automaticVacuumForbidden).toBe(true);
    expect(COMMUNICATION_PERSISTENCE_RETENTION_POLICY.forensicEraseGuaranteed).toBe(false);
    expect(OFFLINE_COMMUNICATION_PERSISTENCE_DIAGNOSTICS.forensicEraseGuaranteed).toBe(false);
  });

  it('documents the future offline factory with fixed false live flags', () => {
    expect(OFFLINE_SQLITE_COMMUNICATION_PORTS_FACTORY_NAME).toBe(
      'createOfflineSqliteCommunicationPorts',
    );
    expect(OFFLINE_SQLITE_COMMUNICATION_PORTS_FACTORY_MODULE).toBe(
      'host/storage/sqlite/communication/create-offline-sqlite-communication-ports.ts',
    );
    expect(OFFLINE_SQLITE_COMMUNICATION_PORTS_FACTORY_FLAGS).toEqual({
      maxOutboxTtlMs: 86_400_000,
      livePersistenceAllowed: false,
      encryptionEnabled: false,
      deliveryExecutionAvailable: false,
      automaticResendAvailable: false,
      productionWired: false,
    });
  });
});
