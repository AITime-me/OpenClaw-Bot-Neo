import { describe, expect, it } from 'vitest';
import { parseConversationRevision } from '../../src/core/communication/domain/index.js';
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
import {
  COMMUNICATION_PERSISTENCE_FACADE_EXPORT_MANIFESTS,
  extractExportedNames,
} from '../../scripts/lib/boundary-checker.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type OutcomeKind<T> = T extends { readonly kind: infer K } ? K : never;

const asRevision = (value: number) => {
  const parsed = parseConversationRevision(value);
  if (!parsed.ok) throw new Error('revision fixture must parse');
  return parsed.value;
};

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

  it('rejects empty, oversized, non-array, illegal, and duplicate states with CONFIG_INVALID', () => {
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

    const notArray = validateCommunicationRecoveryCandidateQuery({
      states: 'queued',
      limit: 1,
    });
    expect(notArray.ok).toBe(false);
    if (notArray.ok) return;
    expect(notArray.error.code).toBe('CONFIG_INVALID');

    const illegal = validateCommunicationRecoveryCandidateQuery({
      states: ['not-a-real-state'],
      limit: 1,
    });
    expect(illegal.ok).toBe(false);
    if (illegal.ok) return;
    expect(illegal.error.code).toBe('CONFIG_INVALID');

    const duplicates = validateCommunicationRecoveryCandidateQuery({
      states: ['queued', 'queued'],
      limit: 1,
    });
    expect(duplicates.ok).toBe(false);
    if (duplicates.ok) return;
    expect(duplicates.error.code).toBe('CONFIG_INVALID');
  });

  it('rejects non-safe-integer limits with CONFIG_INVALID', () => {
    const cases: unknown[] = [
      0,
      101,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
      '10',
      null,
      undefined,
    ];
    for (const limit of cases) {
      const result = validateCommunicationRecoveryCandidateQuery({
        states: ['completed'],
        limit,
      });
      expect(result.ok, `limit=${String(limit)}`).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('CONFIG_INVALID');
    }
  });

  it('accepts safe integer limits at the inclusive bounds', () => {
    expect(
      validateCommunicationRecoveryCandidateQuery({ states: ['completed'], limit: 1 }).ok,
    ).toBe(true);
    expect(
      validateCommunicationRecoveryCandidateQuery({ states: ['completed'], limit: 100 }).ok,
    ).toBe(true);
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

  it('enumerates the typed reconcile outcome union with required fields', () => {
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

    const revision = asRevision(3);
    const reconciled: ConversationStateReconcileCheckpointOutcome = {
      kind: 'reconciled',
      revision,
    };
    const already: ConversationStateReconcileCheckpointOutcome = {
      kind: 'already-reconciled',
      revision,
    };
    const notFound: ConversationStateReconcileCheckpointOutcome = { kind: 'not-found' };
    const notEligibleRequired: ConversationStateReconcileCheckpointOutcome = {
      kind: 'not-eligible',
      status: 'not_required',
      currentRevision: revision,
    };
    const notEligibleSucceeded: ConversationStateReconcileCheckpointOutcome = {
      kind: 'not-eligible',
      status: 'succeeded',
      currentRevision: revision,
    };
    const stale: ConversationStateReconcileCheckpointOutcome = {
      kind: 'stale-revision',
      currentRevision: revision,
    };
    const conflict: ConversationStateReconcileCheckpointOutcome = {
      kind: 'idempotency-conflict',
    };
    const unavailable: ConversationStateReconcileCheckpointOutcome = {
      kind: 'unavailable',
      reason: 'store unavailable',
    };

    expect(reconciled.kind).toBe('reconciled');
    expect(already.kind).toBe('already-reconciled');
    expect(notFound.kind).toBe('not-found');
    expect(notEligibleRequired.status).toBe('not_required');
    expect(notEligibleSucceeded.status).toBe('succeeded');
    expect(stale.currentRevision).toBe(revision);
    expect(conflict.kind).toBe('idempotency-conflict');
    expect(unavailable.reason).toMatch(/unavailable/i);
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

describe('Build 3.7C0 persistence facade export manifests', () => {
  it('matches exact production facade export surfaces', () => {
    for (const [relativePath, manifest] of Object.entries(
      COMMUNICATION_PERSISTENCE_FACADE_EXPORT_MANIFESTS,
    )) {
      const absolute = join(process.cwd(), 'src', relativePath);
      const exported = extractExportedNames(readFileSync(absolute, 'utf8'), absolute);
      expect(exported.hasExportStar, relativePath).toBe(false);
      expect(exported.hasReexport, relativePath).toBe(false);
      expect(exported.names).toEqual([...manifest.allowedExports].sort());
      expect(manifest.allowedImporters).toEqual([
        'host/storage/sqlite/communication/create-offline-sqlite-communication-ports.ts',
      ]);
    }
  });
});
