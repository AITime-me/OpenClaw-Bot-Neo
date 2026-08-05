import { err, ok } from '../../../../core/domain/result.js';
import type { DomainError } from '../../../../core/domain/errors.js';
import type { CorrelationId, ISO8601, PayloadDigest } from '../../../../core/domain/identity.js';
import {
  communicationError,
  type CommunicationError,
} from '../../../../core/communication/domain/communication-errors.js';
import type { ValidatedTextOutput } from '../../../../core/communication/domain/text-delivery.js';
import type { TurnId } from '../../../../core/communication/domain/communication-identity.js';
import { OFFLINE_OUTBOX_MAX_TTL_MS } from '../../../../core/communication/ports/offline-communication-persistence.contract.js';
import type {
  CommunicationDeliveryOutboxLoadPendingOutcome,
  CommunicationDeliveryOutboxPort,
  CommunicationDeliveryOutboxPutOutcome,
  CommunicationDeliveryOutboxRecordOutcomeResult,
  CommunicationDeliveryOutboxReconcileOutcome,
  CommunicationDeliveryOutboxReconciliationCandidateOutcome,
  CommunicationDeliveryOutcomeKind,
} from '../../../../core/communication/ports/communication-delivery-outbox.port.js';
import type { SqliteDatabase, SqliteStatement } from '../better-sqlite3-driver.js';
import { encodeOutboxPlaintext } from './sqlite-communication-serialization.js';
import {
  isSqliteBusyOrLocked,
  isSqliteUniqueConstraint,
  runImmediate,
} from './sqlite-communication-errors.js';

export type OutboxFacadeDeps = {
  readonly isGenuineValidatedOutput: (value: unknown) => value is ValidatedTextOutput;
  readonly readOutputPlaintext: (value: ValidatedTextOutput) => string | null;
  readonly readPrincipalBindingVersion: (principal: unknown) => string | null;
  readonly isGenuinePrincipal: (principal: unknown) => boolean;
};

type EntryRow = {
  readonly turn_id: string;
  readonly correlation_id: string;
  readonly output_digest: string;
  readonly expires_at: string;
  readonly sealed_binding_version: string;
  readonly plaintext_payload: string | null;
  readonly scrubbed: number;
  readonly created_at: string;
};

type OutcomeRow = {
  readonly turn_id: string;
  readonly correlation_id: string;
  readonly idempotency_key: string;
  readonly outcome: string;
  readonly recorded_at: string;
};

type Prepared = {
  readonly scrubExpired: SqliteStatement;
  readonly selectEntry: SqliteStatement;
  readonly insertEntry: SqliteStatement;
  readonly loadPending: SqliteStatement;
  readonly selectOutcome: SqliteStatement;
  readonly insertOutcome: SqliteStatement;
  readonly selectReconcileByKey: SqliteStatement;
  readonly selectReconcileByTurn: SqliteStatement;
  readonly insertReconcile: SqliteStatement;
};

const closedError = (): CommunicationError =>
  communicationError('OUTBOX_UNAVAILABLE', 'Communication delivery outbox is closed.');

const nowIso = (): string => new Date().toISOString();

const prepare = (db: SqliteDatabase): Prepared =>
  Object.freeze({
    scrubExpired: db.prepare(
      `UPDATE outbox_entries
          SET plaintext_payload = NULL, scrubbed = 1
        WHERE expires_at < ? AND scrubbed = 0`,
    ),
    selectEntry: db.prepare(
      `SELECT * FROM outbox_entries
        WHERE turn_id = ? AND correlation_id = ? AND output_digest = ?
        LIMIT 1`,
    ),
    insertEntry: db.prepare(
      `INSERT INTO outbox_entries (
          turn_id, correlation_id, output_digest, expires_at, sealed_binding_version,
          plaintext_payload, scrubbed, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    ),
    loadPending: db.prepare(
      `SELECT turn_id, correlation_id, output_digest, expires_at, sealed_binding_version
         FROM outbox_entries
        WHERE turn_id = ? AND correlation_id = ?
          AND scrubbed = 0
          AND expires_at >= ?
        ORDER BY created_at ASC, output_digest ASC
        LIMIT ?`,
    ),
    selectOutcome: db.prepare(
      `SELECT * FROM outbox_outcomes WHERE turn_id = ? AND correlation_id = ? LIMIT 1`,
    ),
    insertOutcome: db.prepare(
      `INSERT INTO outbox_outcomes (turn_id, correlation_id, idempotency_key, outcome, recorded_at)
       VALUES (?, ?, ?, ?, ?)`,
    ),
    selectReconcileByKey: db.prepare(
      `SELECT idempotency_key FROM outbox_reconcile_ops WHERE idempotency_key = ? LIMIT 1`,
    ),
    selectReconcileByTurn: db.prepare(
      `SELECT idempotency_key FROM outbox_reconcile_ops
        WHERE turn_id = ? AND correlation_id = ?
        LIMIT 1`,
    ),
    insertReconcile: db.prepare(
      `INSERT INTO outbox_reconcile_ops (idempotency_key, turn_id, correlation_id, created_at)
       VALUES (?, ?, ?, ?)`,
    ),
  });

const parseExpiresAtMs = (expiresAt: string): number | null => {
  const ms = Date.parse(expiresAt);
  if (!Number.isFinite(ms)) return null;
  return ms;
};

export const scrubExpiredOutboxPlaintext = (db: SqliteDatabase, now: string): void => {
  db.prepare(
    `UPDATE outbox_entries
        SET plaintext_payload = NULL, scrubbed = 1
      WHERE expires_at < ? AND scrubbed = 0`,
  ).run(now);
};

export const createSqliteCommunicationDeliveryOutboxPort = (
  db: SqliteDatabase,
  assertOpen: () => DomainError | null,
  facades: OutboxFacadeDeps,
  options: { readonly maxOutboxTtlMs: typeof OFFLINE_OUTBOX_MAX_TTL_MS } = {
    maxOutboxTtlMs: OFFLINE_OUTBOX_MAX_TTL_MS,
  },
): CommunicationDeliveryOutboxPort => {
  const statements = prepare(db);

  const requireOpen = (): CommunicationError | null => {
    if (assertOpen() !== null) return closedError();
    return null;
  };

  const scrubBeforeMethod = (): void => {
    statements.scrubExpired.run(nowIso());
  };

  return {
    async put(command, _operationContext) {
      await Promise.resolve();
      void _operationContext;
      const closed = requireOpen();
      if (closed) return err(closed);
      scrubBeforeMethod();

      if (!facades.isGenuinePrincipal(command.principal))
        return ok({ kind: 'rejected', reason: 'Principal is not genuine.' });
      if (!facades.isGenuineValidatedOutput(command.output))
        return ok({ kind: 'rejected', reason: 'Validated text output is not genuine.' });

      const bindingVersion = facades.readPrincipalBindingVersion(command.principal);
      if (bindingVersion === null)
        return ok({ kind: 'rejected', reason: 'Principal binding version unavailable.' });

      const plaintext = facades.readOutputPlaintext(command.output);
      if (plaintext === null)
        return ok({ kind: 'rejected', reason: 'Validated text output plaintext unavailable.' });
      const encoded = encodeOutboxPlaintext(plaintext);
      if (!encoded.ok) return ok({ kind: 'rejected', reason: 'Outbox plaintext rejected.' });

      const expiresMs = parseExpiresAtMs(command.expiresAt);
      if (expiresMs === null)
        return ok({ kind: 'rejected', reason: 'expiresAt must be a valid ISO-8601 timestamp.' });
      const nowMs = Date.now();
      if (expiresMs <= nowMs)
        return ok({ kind: 'rejected', reason: 'expiresAt must be in the future.' });
      if (expiresMs - nowMs > options.maxOutboxTtlMs)
        return ok({
          kind: 'rejected',
          reason: `Outbox plaintext TTL must not exceed ${String(options.maxOutboxTtlMs)} ms.`,
        });

      try {
        const outcome = runImmediate(db, (): CommunicationDeliveryOutboxPutOutcome => {
          const existing = statements.selectEntry.get(
            command.turnId,
            command.correlationId,
            command.outputDigest,
          ) as EntryRow | undefined;
          if (existing !== undefined) return { kind: 'already-stored' };
          try {
            statements.insertEntry.run(
              command.turnId,
              command.correlationId,
              command.outputDigest,
              command.expiresAt,
              bindingVersion,
              encoded.plaintext,
              nowIso(),
            );
          } catch (error) {
            if (isSqliteUniqueConstraint(error)) return { kind: 'already-stored' };
            throw error;
          }
          return { kind: 'stored' };
        });
        return ok(outcome);
      } catch (error) {
        if (isSqliteBusyOrLocked(error))
          return ok({ kind: 'unavailable', reason: 'SQLite database is busy or locked.' });
        return ok({ kind: 'unavailable', reason: 'Outbox put failed.' });
      }
    },

    async loadPending(query, _operationContext) {
      await Promise.resolve();
      void _operationContext;
      const closed = requireOpen();
      if (closed) return err(closed);
      scrubBeforeMethod();
      if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 100)
        return err(communicationError('CONFIG_INVALID', 'Outbox pending limit is invalid.'));
      try {
        const now = nowIso();
        const rows = statements.loadPending.all(
          query.turnId,
          query.correlationId,
          now,
          query.limit,
        ) as Array<{
          turn_id: string;
          correlation_id: string;
          output_digest: string;
          expires_at: string;
          sealed_binding_version: string;
        }>;
        if (rows.length === 0) return ok({ kind: 'not-found' });
        const outcome: CommunicationDeliveryOutboxLoadPendingOutcome = {
          kind: 'found',
          entries: Object.freeze(
            rows.map((row) =>
              Object.freeze({
                turnId: row.turn_id as TurnId,
                correlationId: row.correlation_id as CorrelationId,
                outputDigest: row.output_digest as PayloadDigest,
                expiresAt: row.expires_at as ISO8601,
                sealedBindingVersion: row.sealed_binding_version,
              }),
            ),
          ),
        };
        return ok(outcome);
      } catch (error) {
        if (isSqliteBusyOrLocked(error))
          return ok({ kind: 'unavailable', reason: 'SQLite database is busy or locked.' });
        return ok({ kind: 'unavailable', reason: 'Outbox loadPending failed.' });
      }
    },

    async recordDeliveryOutcome(command, _operationContext) {
      await Promise.resolve();
      void _operationContext;
      const closed = requireOpen();
      if (closed) return err(closed);
      scrubBeforeMethod();
      try {
        const outcome = runImmediate(db, (): CommunicationDeliveryOutboxRecordOutcomeResult => {
          const existing = statements.selectOutcome.get(command.turnId, command.correlationId) as
            OutcomeRow | undefined;
          if (existing !== undefined) {
            if (
              existing.outcome === command.outcome &&
              existing.idempotency_key === command.idempotencyKey
            )
              return { kind: 'already-recorded' };
            if (existing.outcome === 'outcome-unknown') return { kind: 'already-recorded' };
            if (existing.outcome === command.outcome) return { kind: 'already-recorded' };
            return { kind: 'unavailable', reason: 'Delivery outcome is immutable.' };
          }
          try {
            statements.insertOutcome.run(
              command.turnId,
              command.correlationId,
              command.idempotencyKey,
              command.outcome,
              nowIso(),
            );
          } catch (error) {
            if (isSqliteUniqueConstraint(error)) return { kind: 'already-recorded' };
            throw error;
          }
          return { kind: 'recorded' };
        });
        return ok(outcome);
      } catch (error) {
        if (isSqliteBusyOrLocked(error))
          return ok({ kind: 'unavailable', reason: 'SQLite database is busy or locked.' });
        return ok({ kind: 'unavailable', reason: 'Outbox delivery outcome persistence failed.' });
      }
    },

    async getReconciliationCandidate(query, _operationContext) {
      await Promise.resolve();
      void _operationContext;
      const closed = requireOpen();
      if (closed) return err(closed);
      scrubBeforeMethod();
      try {
        const existing = statements.selectOutcome.get(query.turnId, query.correlationId) as
          OutcomeRow | undefined;
        if (existing === undefined || existing.outcome !== 'outcome-unknown')
          return ok({ kind: 'not-found' });
        const outcome: CommunicationDeliveryOutboxReconciliationCandidateOutcome = {
          kind: 'candidate',
          turnId: query.turnId,
          correlationId: query.correlationId,
          outcome: 'outcome-unknown',
        };
        return ok(outcome);
      } catch (error) {
        if (isSqliteBusyOrLocked(error))
          return ok({ kind: 'unavailable', reason: 'SQLite database is busy or locked.' });
        return ok({
          kind: 'unavailable',
          reason: 'Outbox reconciliation candidate lookup failed.',
        });
      }
    },

    async reconcile(command, _operationContext) {
      await Promise.resolve();
      void _operationContext;
      const closed = requireOpen();
      if (closed) return err(closed);
      scrubBeforeMethod();
      try {
        const outcome = runImmediate(db, (): CommunicationDeliveryOutboxReconcileOutcome => {
          const byKey = statements.selectReconcileByKey.get(command.idempotencyKey) as
            { idempotency_key: string } | undefined;
          if (byKey !== undefined) return { kind: 'already-reconciled' };

          const byTurn = statements.selectReconcileByTurn.get(
            command.turnId,
            command.correlationId,
          ) as { idempotency_key: string } | undefined;
          if (byTurn !== undefined) return { kind: 'already-reconciled' };

          const existing = statements.selectOutcome.get(command.turnId, command.correlationId) as
            OutcomeRow | undefined;
          if (existing === undefined || existing.outcome !== 'outcome-unknown')
            return {
              kind: 'not-eligible',
              reason: 'Reconciliation requires a durable outcome-unknown fact.',
            };

          try {
            statements.insertReconcile.run(
              command.idempotencyKey,
              command.turnId,
              command.correlationId,
              nowIso(),
            );
          } catch (error) {
            if (isSqliteUniqueConstraint(error)) return { kind: 'already-reconciled' };
            throw error;
          }
          // Reconciliation does not resend and does not execute delivery.
          return { kind: 'reconciled' };
        });
        return ok(outcome);
      } catch (error) {
        if (isSqliteBusyOrLocked(error))
          return ok({ kind: 'unavailable', reason: 'SQLite database is busy or locked.' });
        return ok({ kind: 'unavailable', reason: 'Outbox reconciliation failed.' });
      }
    },
  };
};

export type { CommunicationDeliveryOutcomeKind };
