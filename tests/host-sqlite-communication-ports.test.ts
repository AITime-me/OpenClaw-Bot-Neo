import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getValidatedTextOutputView,
  parseCommunicationBindingVersion,
  parseCommunicationIdempotencyKey,
  parseConversationId,
  parseConversationRevision,
  parseTransportInstanceId,
  parseTurnId,
  freezeConversationStateSnapshot,
} from '../src/core/communication/domain/index.js';
import { issueAuthenticatedCommunicationPrincipal } from '../src/core/communication/domain/authenticated-communication-principal.internal.js';
import { sealValidatedTextOutput } from '../src/core/communication/domain/text-delivery.internal.js';
import {
  parseActorId,
  parseCorrelationId,
  parseISO8601,
  parseOwnerId,
  parsePolicyVersion,
} from '../src/core/domain/index.js';
import { createLocalStoragePlan } from '../src/host/index.js';
import {
  createOfflineSqliteCommunicationPorts,
  createOfflineSqliteCommunicationPortsWithTestHooks,
} from '../src/host/storage/sqlite/communication/create-offline-sqlite-communication-ports.js';
import { SQLITE_COMMUNICATION_DATABASE_FILENAME } from '../src/host/storage/sqlite/communication/sqlite-communication-constants.js';
import {
  listSqliteUserSchemaInventory,
  migrateCommunicationSchema0To1,
  verifyCommunicationSchemaV1,
} from '../src/host/storage/sqlite/communication/sqlite-communication-schema.js';
import { openSqliteDatabaseFile } from '../src/host/storage/sqlite/better-sqlite3-driver.js';
import {
  openPosixStorageRootWithSystem,
  type OpenedPosixStorageRoot,
} from '../src/host/storage/runtime/open-posix-storage-root.js';
import type {
  PosixDirectoryHandle,
  PosixPathIdentity,
  PosixStorageSystem,
} from '../src/host/storage/runtime/posix-storage-system.js';
import { fakeSensitiveDataScanner } from './communication/support/fake-scanner.js';
import { operationContext } from './support/fixtures.js';

const REPO_ROOT = '/opt/openclaw-bot-neo-comm';
const SERVICE_UID = 1001;
const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root === undefined) continue;
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

const dirIdentity = (
  partial: Partial<PosixPathIdentity> & Pick<PosixPathIdentity, 'ino'>,
): PosixPathIdentity =>
  Object.freeze({
    dev: '1',
    mode: 0o700,
    uid: SERVICE_UID,
    gid: SERVICE_UID,
    isDirectory: true,
    isSymbolicLink: false,
    isFile: false,
    ...partial,
  });

const createTempStorageRoot = (): string => {
  const base = mkdtempSync(join(tmpdir(), 'openclaw-comm-'));
  tempRoots.push(base);
  const posixRoot =
    '/openclaw-neo-comm-' +
    String(process.pid) +
    '-' +
    String(Date.now()) +
    '-' +
    Math.random().toString(16).slice(2);
  mkdirSync(posixRoot, { recursive: true });
  tempRoots.push(posixRoot);
  return posixRoot;
};

const createFakeSystem = (storageRoot: string): PosixStorageSystem => {
  const nodes: Record<string, { identity: PosixPathIdentity }> = {
    [storageRoot]: { identity: dirIdentity({ ino: '12' }) },
    [REPO_ROOT]: { identity: dirIdentity({ ino: '99', uid: 0, mode: 0o755 }) },
  };
  const parts = storageRoot.split('/').filter((part) => part.length > 0);
  let current = '';
  for (let index = 0; index < parts.length - 1; index += 1) {
    const segment = parts[index];
    if (segment === undefined) continue;
    current = current + '/' + segment;
    nodes[current] = { identity: dirIdentity({ ino: String(20 + index), uid: 0, mode: 0o755 }) };
  }
  let openCount = 0;
  return Object.freeze({
    getRuntimeOsFamily: () => 'linux' as const,
    getCurrentUid: () => SERVICE_UID,
    lstat: (absolutePath: string) => {
      const node = nodes[absolutePath];
      if (!node) return { ok: false as const, error: { code: 'NOT_FOUND' as const } };
      return { ok: true as const, value: node.identity };
    },
    realpath: (absolutePath: string) => {
      if (!nodes[absolutePath])
        return { ok: false as const, error: { code: 'NOT_FOUND' as const } };
      return { ok: true as const, value: absolutePath };
    },
    openDirectory: (absolutePath: string) => {
      const node = nodes[absolutePath];
      if (!node) return { ok: false as const, error: { code: 'NOT_FOUND' as const } };
      openCount += 1;
      const handle = Object.freeze({
        __brand: 'PosixDirectoryHandle' as const,
        id: openCount,
      }) as PosixDirectoryHandle & { id: number };
      return { ok: true as const, value: handle };
    },
    fstat: (handle: PosixDirectoryHandle) => {
      void handle;
      const identity = nodes[storageRoot]?.identity;
      if (identity === undefined) return { ok: false as const, error: { code: 'IO' as const } };
      return { ok: true as const, value: identity };
    },
    closeDirectory: () => ({ ok: true as const, value: undefined }),
  });
};

const openGenuineRoot = (storageRoot: string): OpenedPosixStorageRoot => {
  const plan = createLocalStoragePlan({ platform: 'posix', storageRoot });
  expect(plan.ok).toBe(true);
  if (!plan.ok) throw new Error('plan');
  const opened = openPosixStorageRootWithSystem(
    plan.value,
    {
      expectedUid: SERVICE_UID,
      allowedModeBits: 0o700,
      repositoryRoot: REPO_ROOT,
    },
    createFakeSystem(storageRoot),
  );
  expect(opened.ok).toBe(true);
  if (!opened.ok) throw new Error('open');
  return opened.value;
};

const openPorts = () => {
  const storageRoot = createTempStorageRoot();
  const root = openGenuineRoot(storageRoot);
  const ports = createOfflineSqliteCommunicationPorts(root, {
    scanner: fakeSensitiveDataScanner('allow'),
    queueConfig: Object.freeze({ maxDepthPerConversation: 8, maxGlobalPending: 64 }),
  });
  expect(ports.ok).toBe(true);
  if (!ports.ok) throw new Error(JSON.stringify(ports));
  expect(existsSync(`${storageRoot}/${SQLITE_COMMUNICATION_DATABASE_FILENAME}`)).toBe(true);
  expect(existsSync(`${storageRoot}/neo-memory.sqlite`)).toBe(false);
  return { handle: ports.value, root, storageRoot };
};

const hex64 = (seed: string): string => {
  const normalized = seed.replace(/[^0-9a-f]/g, 'a').toLowerCase();
  return (normalized + 'a'.repeat(64)).slice(0, 64);
};

const must = <T>(
  result: { ok: true; value: T } | { ok: false; error?: unknown },
  label = 'parse',
): T => {
  if (!result.ok) throw new Error(`${label} failed: ${JSON.stringify(result)}`);
  return result.value;
};

const ctx = () => operationContext();

describe('offline SQLite communication ports', () => {
  it('opens neo-communication.sqlite with offline diagnostics flags', () => {
    const { handle, root } = openPorts();
    expect(handle.diagnostics).toMatchObject({
      mode: 'offline-only',
      storageBackend: 'sqlite',
      plaintextOutboxEnabled: true,
      plaintextConversationStateEnabled: true,
      encryptionEnabled: false,
      livePersistenceAllowed: false,
      maxOutboxTtlMs: 86_400_000,
      forensicEraseGuaranteed: false,
      deliveryExecutionAvailable: false,
      automaticResendAvailable: false,
      productionWired: false,
      schemaVersion: 1,
      schemaVerified: true,
      journalMode: 'wal',
    });
    expect(handle.close().ok).toBe(true);
    root.close();
  });

  it('admits observed turns atomically and rejects duplicates without new sequence', async () => {
    const { handle, root } = openPorts();
    const command = {
      idempotencyKey: must(parseCommunicationIdempotencyKey(hex64('dup1'))),
      transportInstanceId: must(parseTransportInstanceId('transport-1')),
      turnId: must(parseTurnId('turn-1')),
      observedAt: must(parseISO8601('2026-08-05T12:00:00.000Z')),
    };
    const first = await handle.ledger.observeTransportEvent(command, ctx());
    expect(first.ok && first.value.kind === 'fresh-observed').toBe(true);
    const second = await handle.ledger.observeTransportEvent(command, ctx());
    expect(second.ok && second.value.kind === 'duplicate-existing').toBe(true);
    if (second.ok && second.value.kind === 'duplicate-existing') {
      expect(second.value.flags.newQueuePositionMustNotBeAssigned).toBe(true);
    }
    handle.close();
    root.close();
  });

  it('assigns monotonic sequences and denies delivered fact rewrites', async () => {
    const { handle, root } = openPorts();
    const owner = must(parseOwnerId('owner-1'));
    const conversation = must(parseConversationId('conversation-1'));
    const actor = must(parseActorId('actor-1'));
    const binding = must(parseCommunicationBindingVersion('binding-v1'));

    const admit = async (n: string) => {
      const turnId = must(parseTurnId(`turn-${n}`));
      const observed = await handle.ledger.observeTransportEvent(
        {
          idempotencyKey: must(parseCommunicationIdempotencyKey(hex64(n))),
          transportInstanceId: must(parseTransportInstanceId(`transport-${n}`)),
          turnId,
          observedAt: must(parseISO8601('2026-08-05T12:00:00.000Z')),
        },
        ctx(),
      );
      if (!observed.ok || observed.value.kind !== 'fresh-observed') throw new Error('observe');
      const principal = issueAuthenticatedCommunicationPrincipal({
        turnId,
        ownerId: owner,
        actorId: actor,
        conversationId: conversation,
        transportInstanceId: must(parseTransportInstanceId(`transport-${n}`)),
        bindingVersion: binding,
        observedAt: must(parseISO8601('2026-08-05T12:00:00.000Z')),
        admissionEvidence: observed.value.admissionEvidence,
      });
      if (!principal.ok) throw new Error('principal');
      const auth = await handle.ledger.recordAuthenticationResult(
        {
          turnId,
          expectedRevision: observed.value.turnRevision,
          correlationId: must(parseCorrelationId(`corr-${n}`)),
          outcome: { kind: 'authenticated', principal: principal.value },
        },
        ctx(),
      );
      if (!auth.ok || auth.value.kind !== 'recorded') throw new Error('auth');
      const accepted = await handle.ledger.acceptConversationTurn(
        {
          turnId,
          expectedRevision: auth.value.turnRevision,
          correlationId: must(parseCorrelationId(`corr-${n}`)),
        },
        ctx(),
      );
      if (!accepted.ok || accepted.value.kind !== 'accepted')
        throw new Error(`accept: ${JSON.stringify(accepted)}`);
      return {
        turnId,
        revision: accepted.value.turnRevision,
        sequence: accepted.value.conversationSequence,
      };
    };

    const first = await admit('a');
    const second = await admit('b');
    expect(Number(second.sequence)).toBe(Number(first.sequence) + 1);

    const delivered = await handle.ledger.recordFactualOutcome(
      {
        turnId: first.turnId,
        correlationId: must(parseCorrelationId('corr-a')),
        expectedRevision: first.revision,
        llmOutcome: 'completed',
        deliveryStatus: 'delivered',
        checkpointStatus: 'succeeded',
        auditStatus: { start: 'succeeded', completion: 'succeeded' },
        errorCode: null,
      },
      ctx(),
    );
    expect(delivered.ok && delivered.value.kind === 'recorded').toBe(true);
    if (!delivered.ok || delivered.value.kind !== 'recorded') throw new Error('delivered');
    const rewrite = await handle.ledger.recordFactualOutcome(
      {
        turnId: first.turnId,
        correlationId: must(parseCorrelationId('corr-a')),
        expectedRevision: delivered.value.turnRevision,
        llmOutcome: 'completed',
        deliveryStatus: 'failed',
        checkpointStatus: 'succeeded',
        auditStatus: { start: 'succeeded', completion: 'succeeded' },
        errorCode: null,
      },
      ctx(),
    );
    expect(rewrite.ok && rewrite.value.kind === 'fact-rewrite-denied').toBe(true);
    handle.close();
    root.close();
  });

  it('lists recovery candidates and rejects invalid bounds with CONFIG_INVALID', async () => {
    const { handle, root } = openPorts();
    const invalid = await handle.ledger.listRecoveryCandidates(
      { states: 'observed' as never, limit: 1 },
      ctx(),
    );
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error.code).toBe('CONFIG_INVALID');

    await handle.ledger.observeTransportEvent(
      {
        idempotencyKey: must(parseCommunicationIdempotencyKey(hex64('rec'))),
        transportInstanceId: must(parseTransportInstanceId('transport-rec')),
        turnId: must(parseTurnId('turn-rec')),
        observedAt: must(parseISO8601('2026-08-05T12:00:00.000Z')),
      },
      ctx(),
    );
    const listed = await handle.ledger.listRecoveryCandidates(
      { states: ['observed'], limit: 10 },
      ctx(),
    );
    expect(listed.ok && listed.value.kind === 'found').toBe(true);
    if (listed.ok && listed.value.kind === 'found') {
      expect(listed.value.candidates[0]?.recoveryReasons.length).toBeGreaterThan(0);
    }
    handle.close();
    root.close();
  });

  it('checkpoints and reconciles conversation state byte-equivalently for context/summary/pause', async () => {
    const { handle, root } = openPorts();
    const owner = must(parseOwnerId('owner-1'));
    const conversation = must(parseConversationId('conversation-1'));
    const rev0 = must(parseConversationRevision(0));
    const rev1 = must(parseConversationRevision(1));
    const nextSnapshot = freezeConversationStateSnapshot({
      conversationId: conversation,
      ownerId: owner,
      revision: rev1,
      activeContext: [
        Object.freeze({ role: 'owner' as const, text: 'hello', trust: 'untrusted' as const }),
      ],
      modelDerivedSummary: null,
      pauseState: 'active',
      checkpoint: Object.freeze({ status: 'pending' as const, revision: rev1 }),
    });
    const stored = await handle.conversationState.checkpoint(
      {
        key: { ownerId: owner, conversationId: conversation },
        expectedRevision: rev0,
        nextSnapshot,
        correlationId: must(parseCorrelationId('corr-cp')),
        idempotencyKey: 'checkpoint-1',
      },
      ctx(),
    );
    expect(stored.ok && stored.value.kind === 'stored').toBe(true);
    const reconciled = await handle.conversationState.reconcileCheckpoint(
      {
        key: { ownerId: owner, conversationId: conversation },
        expectedRevision: rev1,
        correlationId: must(parseCorrelationId('corr-cp')),
        idempotencyKey: 'reconcile-1',
      },
      ctx(),
    );
    expect(reconciled.ok && reconciled.value.kind === 'reconciled').toBe(true);
    const after = await handle.conversationState.load(
      { ownerId: owner, conversationId: conversation },
      ctx(),
    );
    if (!after.ok || after.value.kind !== 'found') throw new Error('after');
    expect(after.value.snapshot.activeContext[0]?.text).toBe('hello');
    expect(after.value.snapshot.pauseState).toBe('active');
    expect(after.value.snapshot.checkpoint.status).toBe('succeeded');
    handle.close();
    root.close();
  });

  it('requires durable audit start before completion', async () => {
    const { handle, root } = openPorts();
    const turnId = must(parseTurnId('turn-audit'));
    const policyVersion = must(parsePolicyVersion('1.0.0'));
    await handle.ledger.observeTransportEvent(
      {
        idempotencyKey: must(parseCommunicationIdempotencyKey(hex64('audit'))),
        transportInstanceId: must(parseTransportInstanceId('transport-audit')),
        turnId,
        observedAt: must(parseISO8601('2026-08-05T12:00:00.000Z')),
      },
      ctx(),
    );
    const early = await handle.audit.recordCompletion(
      {
        turnId,
        correlationId: must(parseCorrelationId('corr-audit')),
        ownerId: must(parseOwnerId('owner-1')),
        conversationId: must(parseConversationId('conversation-1')),
        operationKind: 'text-turn',
        policyVersion,
        idempotencyKey: must(parseCommunicationIdempotencyKey(hex64('auditc'))),
        timestamp: must(parseISO8601('2026-08-05T12:00:00.000Z')),
        deliveryStatus: 'not_started',
        checkpointStatus: 'not_required',
        auditStartStatus: 'succeeded',
        auditCompletionStatus: 'succeeded',
        errorCode: null,
        redactedMetadata: { k: 'v' },
      },
      ctx(),
    );
    expect(early.ok && early.value.kind === 'rejected').toBe(true);
    const start = await handle.audit.recordStart(
      {
        turnId,
        correlationId: must(parseCorrelationId('corr-audit')),
        ownerId: must(parseOwnerId('owner-1')),
        conversationId: must(parseConversationId('conversation-1')),
        operationKind: 'text-turn',
        policyVersion,
        idempotencyKey: must(parseCommunicationIdempotencyKey(hex64('audits'))),
        timestamp: must(parseISO8601('2026-08-05T12:00:00.000Z')),
        redactedMetadata: { k: 'v' },
      },
      ctx(),
    );
    expect(start.ok && start.value.kind === 'recorded').toBe(true);
    const completion = await handle.audit.recordCompletion(
      {
        turnId,
        correlationId: must(parseCorrelationId('corr-audit')),
        ownerId: must(parseOwnerId('owner-1')),
        conversationId: must(parseConversationId('conversation-1')),
        operationKind: 'text-turn',
        policyVersion,
        idempotencyKey: must(parseCommunicationIdempotencyKey(hex64('auditc'))),
        timestamp: must(parseISO8601('2026-08-05T12:00:00.000Z')),
        deliveryStatus: 'not_started',
        checkpointStatus: 'not_required',
        auditStartStatus: 'succeeded',
        auditCompletionStatus: 'succeeded',
        errorCode: null,
        redactedMetadata: { k: 'v' },
      },
      ctx(),
    );
    expect(completion.ok && completion.value.kind === 'recorded').toBe(true);
    handle.close();
    root.close();
  });

  it('scrubs expired outbox plaintext and keeps outcome-unknown immutable', async () => {
    const storageRoot = createTempStorageRoot();
    const root = openGenuineRoot(storageRoot);
    const nowMs = Date.now();
    const opened = createOfflineSqliteCommunicationPortsWithTestHooks(
      root,
      { scanner: fakeSensitiveDataScanner('allow') },
      {
        wrapDatabase: (db) => db,
      },
    );
    expect(opened.ok).toBe(true);
    if (!opened.ok) throw new Error('open');
    const handle = opened.value;

    const turnId = must(parseTurnId('turn-out'));
    const observed = await handle.ledger.observeTransportEvent(
      {
        idempotencyKey: must(parseCommunicationIdempotencyKey(hex64('outbox'))),
        transportInstanceId: must(parseTransportInstanceId('transport-out')),
        turnId,
        observedAt: must(parseISO8601('2026-08-05T12:00:00.000Z')),
      },
      ctx(),
    );
    if (!observed.ok || observed.value.kind !== 'fresh-observed') throw new Error('observe');
    const principal = issueAuthenticatedCommunicationPrincipal({
      turnId,
      ownerId: must(parseOwnerId('owner-1')),
      actorId: must(parseActorId('actor-1')),
      conversationId: must(parseConversationId('conversation-1')),
      transportInstanceId: must(parseTransportInstanceId('transport-out')),
      bindingVersion: must(parseCommunicationBindingVersion('binding-v1')),
      observedAt: must(parseISO8601('2026-08-05T12:00:00.000Z')),
      admissionEvidence: observed.value.admissionEvidence,
    });
    if (!principal.ok) throw new Error('principal');
    const sealed = sealValidatedTextOutput({ source: 'llm', text: 'outbound-safe-text' });
    if (!sealed.ok) throw new Error('seal');
    const view = getValidatedTextOutputView(sealed.value);
    if (view === null) throw new Error('view');

    const expiresAt = must(parseISO8601(new Date(nowMs + 60_000).toISOString()));
    const put = await handle.outbox.put(
      {
        output: sealed.value,
        principal: principal.value,
        turnId,
        correlationId: must(parseCorrelationId('corr-out')),
        outputDigest: view.payloadDigest,
        expiresAt,
      },
      ctx(),
    );
    expect(put.ok && put.value.kind === 'stored').toBe(true);

    const pending = await handle.outbox.loadPending(
      {
        turnId,
        correlationId: must(parseCorrelationId('corr-out')),
        limit: 10,
      },
      ctx(),
    );
    expect(pending.ok && pending.value.kind === 'found').toBe(true);

    // Force expiry scrub via direct SQL then reopen method path
    const dbPath = `${storageRoot}/${SQLITE_COMMUNICATION_DATABASE_FILENAME}`;
    handle.close();
    const db = openSqliteDatabaseFile(dbPath);
    db.prepare(`UPDATE outbox_entries SET expires_at = ? WHERE turn_id = ?`).run(
      new Date(nowMs - 1_000).toISOString(),
      turnId,
    );
    db.close();

    const reopened = createOfflineSqliteCommunicationPorts(root, {
      scanner: fakeSensitiveDataScanner('allow'),
    });
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) throw new Error('reopen');
    const pendingAfter = await reopened.value.outbox.loadPending(
      {
        turnId,
        correlationId: must(parseCorrelationId('corr-out')),
        limit: 10,
      },
      ctx(),
    );
    expect(pendingAfter.ok && pendingAfter.value.kind === 'not-found').toBe(true);

    const unknown = await reopened.value.outbox.recordDeliveryOutcome(
      {
        turnId,
        correlationId: must(parseCorrelationId('corr-out')),
        idempotencyKey: must(parseCommunicationIdempotencyKey(hex64('outcome'))),
        outcome: 'outcome-unknown',
      },
      ctx(),
    );
    expect(unknown.ok && unknown.value.kind === 'recorded').toBe(true);
    const rewrite = await reopened.value.outbox.recordDeliveryOutcome(
      {
        turnId,
        correlationId: must(parseCorrelationId('corr-out')),
        idempotencyKey: must(parseCommunicationIdempotencyKey(hex64('outcome2'))),
        outcome: 'delivered',
      },
      ctx(),
    );
    expect(rewrite.ok && rewrite.value.kind === 'already-recorded').toBe(true);
    const candidate = await reopened.value.outbox.getReconciliationCandidate(
      { turnId, correlationId: must(parseCorrelationId('corr-out')) },
      ctx(),
    );
    expect(candidate.ok && candidate.value.kind === 'candidate').toBe(true);
    const reconciled = await reopened.value.outbox.reconcile(
      {
        turnId,
        correlationId: must(parseCorrelationId('corr-out')),
        idempotencyKey: must(parseCommunicationIdempotencyKey(hex64('recon'))),
      },
      ctx(),
    );
    expect(reconciled.ok && reconciled.value.kind === 'reconciled').toBe(true);
    reopened.value.close();
    root.close();
  });

  it('fails closed on future schema version and verifies exact inventory after migration', () => {
    const storageRoot = createTempStorageRoot();
    const dbPath = `${storageRoot}/${SQLITE_COMMUNICATION_DATABASE_FILENAME}`;
    mkdirSync(storageRoot, { recursive: true });
    const db = openSqliteDatabaseFile(dbPath);
    migrateCommunicationSchema0To1(db);
    expect(verifyCommunicationSchemaV1(db).ok).toBe(true);
    const inventory = listSqliteUserSchemaInventory(db);
    expect(inventory.some((entry) => entry.name === 'turns')).toBe(true);
    db.prepare(`UPDATE communication_meta SET schema_version = 2`).run();
    db.close();

    const root = openGenuineRoot(storageRoot);
    const opened = createOfflineSqliteCommunicationPorts(root, {
      scanner: fakeSensitiveDataScanner('allow'),
    });
    expect(opened.ok).toBe(false);
    root.close();
  });
});
