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
  isSqliteDatabaseEmpty,
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
import { OFFLINE_OUTBOX_MAX_TTL_MS } from '../src/core/communication/ports/offline-communication-persistence.contract.js';
import type { CommunicationQueueConfig } from '../src/core/communication/domain/communication-turn.js';
import type { OfflineSqliteCommunicationPortsHandle } from '../src/host/storage/sqlite/communication/create-offline-sqlite-communication-ports.js';
import type { SensitiveDataScannerPort } from '../src/core/ports/sensitive-data-scanner.port.js';
import {
  fakeSensitiveDataScanner,
  sampleSensitiveFinding,
  unavailableSensitiveDataScanner,
} from './communication/support/fake-scanner.js';
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

describe('Build 3.7C corrective behavioral coverage', () => {
  const defaultQueue = Object.freeze({
    maxDepthPerConversation: 8,
    maxGlobalPending: 64,
  }) satisfies CommunicationQueueConfig;

  const openWith = (overrides?: {
    readonly scanner?: SensitiveDataScannerPort;
    readonly queueConfig?: CommunicationQueueConfig;
  }) => {
    const storageRoot = createTempStorageRoot();
    const root = openGenuineRoot(storageRoot);
    const ports = createOfflineSqliteCommunicationPorts(root, {
      scanner: overrides?.scanner ?? fakeSensitiveDataScanner('allow'),
      queueConfig: overrides?.queueConfig ?? defaultQueue,
    });
    expect(ports.ok).toBe(true);
    if (!ports.ok) throw new Error(JSON.stringify(ports));
    return { handle: ports.value, root, storageRoot };
  };

  const admitTurn = async (
    handle: OfflineSqliteCommunicationPortsHandle,
    seed: string,
    ids: {
      readonly ownerId: string;
      readonly conversationId: string;
    },
  ) => {
    const turnId = must(parseTurnId(`turn-${seed}`));
    const observed = await handle.ledger.observeTransportEvent(
      {
        idempotencyKey: must(parseCommunicationIdempotencyKey(hex64(seed))),
        transportInstanceId: must(parseTransportInstanceId(`transport-${seed}`)),
        turnId,
        observedAt: must(parseISO8601('2026-08-05T12:00:00.000Z')),
      },
      ctx(),
    );
    if (!observed.ok || observed.value.kind !== 'fresh-observed')
      throw new Error(`observe ${seed}: ${JSON.stringify(observed)}`);
    const principal = issueAuthenticatedCommunicationPrincipal({
      turnId,
      ownerId: must(parseOwnerId(ids.ownerId)),
      actorId: must(parseActorId('actor-1')),
      conversationId: must(parseConversationId(ids.conversationId)),
      transportInstanceId: must(parseTransportInstanceId(`transport-${seed}`)),
      bindingVersion: must(parseCommunicationBindingVersion('binding-v1')),
      observedAt: must(parseISO8601('2026-08-05T12:00:00.000Z')),
      admissionEvidence: observed.value.admissionEvidence,
    });
    if (!principal.ok) throw new Error('principal');
    const auth = await handle.ledger.recordAuthenticationResult(
      {
        turnId,
        expectedRevision: observed.value.turnRevision,
        correlationId: must(parseCorrelationId(`corr-${seed}`)),
        outcome: { kind: 'authenticated', principal: principal.value },
      },
      ctx(),
    );
    if (!auth.ok || auth.value.kind !== 'recorded')
      throw new Error(`auth ${seed}: ${JSON.stringify(auth)}`);
    const accepted = await handle.ledger.acceptConversationTurn(
      {
        turnId,
        expectedRevision: auth.value.turnRevision,
        correlationId: must(parseCorrelationId(`corr-${seed}`)),
      },
      ctx(),
    );
    return { turnId, observed, auth, accepted, principal: principal.value };
  };

  it('keeps phase-aware audit scanner taxonomy for start and completion', async () => {
    const allow = openWith({ scanner: fakeSensitiveDataScanner('allow') });
    const deny = openWith({
      scanner: fakeSensitiveDataScanner('deny', 'redacted', [sampleSensitiveFinding()]),
    });
    const unavailable = openWith({ scanner: unavailableSensitiveDataScanner() });
    const policyVersion = must(parsePolicyVersion('1.0.0'));
    const baseMeta = {
      correlationId: must(parseCorrelationId('corr-tax')),
      ownerId: must(parseOwnerId('owner-1')),
      conversationId: must(parseConversationId('conversation-1')),
      operationKind: 'text-turn' as const,
      policyVersion,
      timestamp: must(parseISO8601('2026-08-05T12:00:00.000Z')),
      redactedMetadata: { k: 'v' },
    };

    const turnAllow = must(parseTurnId('turn-tax-allow'));
    await allow.handle.ledger.observeTransportEvent(
      {
        idempotencyKey: must(parseCommunicationIdempotencyKey(hex64('taxallow'))),
        transportInstanceId: must(parseTransportInstanceId('transport-tax-allow')),
        turnId: turnAllow,
        observedAt: must(parseISO8601('2026-08-05T12:00:00.000Z')),
      },
      ctx(),
    );
    const startAllow = await allow.handle.audit.recordStart(
      {
        ...baseMeta,
        turnId: turnAllow,
        idempotencyKey: must(parseCommunicationIdempotencyKey(hex64('taxstarts'))),
      },
      ctx(),
    );
    expect(startAllow.ok && startAllow.value.kind === 'recorded').toBe(true);
    const completionAllow = await allow.handle.audit.recordCompletion(
      {
        ...baseMeta,
        turnId: turnAllow,
        idempotencyKey: must(parseCommunicationIdempotencyKey(hex64('taxcompl'))),
        deliveryStatus: 'not_started',
        checkpointStatus: 'not_required',
        auditStartStatus: 'succeeded',
        auditCompletionStatus: 'succeeded',
        errorCode: null,
      },
      ctx(),
    );
    expect(completionAllow.ok && completionAllow.value.kind === 'recorded').toBe(true);

    const turnDenyStart = must(parseTurnId('turn-tax-deny-s'));
    await deny.handle.ledger.observeTransportEvent(
      {
        idempotencyKey: must(parseCommunicationIdempotencyKey(hex64('taxdenys'))),
        transportInstanceId: must(parseTransportInstanceId('transport-tax-deny-s')),
        turnId: turnDenyStart,
        observedAt: must(parseISO8601('2026-08-05T12:00:00.000Z')),
      },
      ctx(),
    );
    const startDeny = await deny.handle.audit.recordStart(
      {
        ...baseMeta,
        turnId: turnDenyStart,
        idempotencyKey: must(parseCommunicationIdempotencyKey(hex64('taxdenyst'))),
      },
      ctx(),
    );
    expect(startDeny.ok).toBe(false);
    if (!startDeny.ok) expect(startDeny.error.code).toBe('AUDIT_START_FAILED');

    const turnDenyCompletion = must(parseTurnId('turn-tax-deny-c'));
    await deny.handle.ledger.observeTransportEvent(
      {
        idempotencyKey: must(parseCommunicationIdempotencyKey(hex64('taxdenyc'))),
        transportInstanceId: must(parseTransportInstanceId('transport-tax-deny-c')),
        turnId: turnDenyCompletion,
        observedAt: must(parseISO8601('2026-08-05T12:00:00.000Z')),
      },
      ctx(),
    );
    deny.handle.close();
    const denyDbPath = `${deny.storageRoot}/${SQLITE_COMMUNICATION_DATABASE_FILENAME}`;
    const seedDb = openSqliteDatabaseFile(denyDbPath);
    seedDb
      .prepare(
        `INSERT INTO audit_start (
            idempotency_key, turn_id, correlation_id, owner_id, conversation_id,
            operation_kind, policy_version, timestamp, metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        hex64('taxseedst'),
        turnDenyCompletion,
        'corr-tax',
        'owner-1',
        'conversation-1',
        'text-turn',
        '1.0.0',
        '2026-08-05T12:00:00.000Z',
        '{"k":"v"}',
      );
    seedDb.close();
    const denyReopened = createOfflineSqliteCommunicationPorts(deny.root, {
      scanner: fakeSensitiveDataScanner('deny', 'redacted', [sampleSensitiveFinding()]),
      queueConfig: defaultQueue,
    });
    expect(denyReopened.ok).toBe(true);
    if (!denyReopened.ok) throw new Error('reopen deny');
    const completionDeny = await denyReopened.value.audit.recordCompletion(
      {
        ...baseMeta,
        turnId: turnDenyCompletion,
        idempotencyKey: must(parseCommunicationIdempotencyKey(hex64('taxdenycc'))),
        deliveryStatus: 'not_started',
        checkpointStatus: 'not_required',
        auditStartStatus: 'succeeded',
        auditCompletionStatus: 'succeeded',
        errorCode: null,
      },
      ctx(),
    );
    expect(completionDeny.ok).toBe(false);
    if (!completionDeny.ok) expect(completionDeny.error.code).toBe('AUDIT_COMPLETION_FAILED');

    const turnUnavailStart = must(parseTurnId('turn-tax-unavail-s'));
    await unavailable.handle.ledger.observeTransportEvent(
      {
        idempotencyKey: must(parseCommunicationIdempotencyKey(hex64('taxunavs'))),
        transportInstanceId: must(parseTransportInstanceId('transport-tax-unavail-s')),
        turnId: turnUnavailStart,
        observedAt: must(parseISO8601('2026-08-05T12:00:00.000Z')),
      },
      ctx(),
    );
    const startUnavail = await unavailable.handle.audit.recordStart(
      {
        ...baseMeta,
        turnId: turnUnavailStart,
        idempotencyKey: must(parseCommunicationIdempotencyKey(hex64('taxunavst'))),
      },
      ctx(),
    );
    expect(startUnavail.ok).toBe(false);
    if (!startUnavail.ok) expect(startUnavail.error.code).toBe('SECRET_SCAN_UNAVAILABLE');

    unavailable.handle.close();
    const unavailDbPath = `${unavailable.storageRoot}/${SQLITE_COMMUNICATION_DATABASE_FILENAME}`;
    const unavailSeed = openSqliteDatabaseFile(unavailDbPath);
    const turnUnavailCompletion = must(parseTurnId('turn-tax-unavail-c'));
    unavailSeed
      .prepare(
        `INSERT INTO audit_start (
            idempotency_key, turn_id, correlation_id, owner_id, conversation_id,
            operation_kind, policy_version, timestamp, metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        hex64('taxunavseed'),
        turnUnavailCompletion,
        'corr-tax',
        'owner-1',
        'conversation-1',
        'text-turn',
        '1.0.0',
        '2026-08-05T12:00:00.000Z',
        '{"k":"v"}',
      );
    unavailSeed.close();
    const unavailReopened = createOfflineSqliteCommunicationPorts(unavailable.root, {
      scanner: unavailableSensitiveDataScanner(),
      queueConfig: defaultQueue,
    });
    expect(unavailReopened.ok).toBe(true);
    if (!unavailReopened.ok) throw new Error('reopen unavail');
    const completionUnavail = await unavailReopened.value.audit.recordCompletion(
      {
        ...baseMeta,
        turnId: turnUnavailCompletion,
        idempotencyKey: must(parseCommunicationIdempotencyKey(hex64('taxunavcc'))),
        deliveryStatus: 'not_started',
        checkpointStatus: 'not_required',
        auditStartStatus: 'succeeded',
        auditCompletionStatus: 'succeeded',
        errorCode: null,
      },
      ctx(),
    );
    expect(completionUnavail.ok).toBe(false);
    if (!completionUnavail.ok) expect(completionUnavail.error.code).toBe('SECRET_SCAN_UNAVAILABLE');

    allow.handle.close();
    allow.root.close();
    denyReopened.value.close();
    deny.root.close();
    unavailReopened.value.close();
    unavailable.root.close();
  });

  it('rejects outbox TTL at now and beyond 24h; allows +1ms and exactly 24h', async () => {
    const { handle, root } = openWith();
    const turnId = must(parseTurnId('turn-ttl'));
    const observed = await handle.ledger.observeTransportEvent(
      {
        idempotencyKey: must(parseCommunicationIdempotencyKey(hex64('ttl'))),
        transportInstanceId: must(parseTransportInstanceId('transport-ttl')),
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
      transportInstanceId: must(parseTransportInstanceId('transport-ttl')),
      bindingVersion: must(parseCommunicationBindingVersion('binding-v1')),
      observedAt: must(parseISO8601('2026-08-05T12:00:00.000Z')),
      admissionEvidence: observed.value.admissionEvidence,
    });
    if (!principal.ok) throw new Error('principal');
    const sealed = sealValidatedTextOutput({ source: 'llm', text: 'ttl-safe-text' });
    if (!sealed.ok) throw new Error('seal');
    const view = getValidatedTextOutputView(sealed.value);
    if (view === null) throw new Error('view');

    const putAt = async (expiresAtMs: number) =>
      handle.outbox.put(
        {
          output: sealed.value,
          principal: principal.value,
          turnId,
          correlationId: must(parseCorrelationId(`corr-ttl-${String(expiresAtMs)}`)),
          outputDigest: view.payloadDigest,
          expiresAt: must(parseISO8601(new Date(expiresAtMs).toISOString())),
        },
        ctx(),
      );

    const nowMs = Date.now();
    const atNow = await putAt(nowMs);
    expect(atNow.ok && atNow.value.kind === 'rejected').toBe(true);

    const plusOne = await putAt(nowMs + 1);
    expect(plusOne.ok && plusOne.value.kind === 'stored').toBe(true);

    const sealed2 = sealValidatedTextOutput({ source: 'llm', text: 'ttl-safe-text-2' });
    if (!sealed2.ok) throw new Error('seal2');
    const view2 = getValidatedTextOutputView(sealed2.value);
    if (view2 === null) throw new Error('view2');
    const at24h = await handle.outbox.put(
      {
        output: sealed2.value,
        principal: principal.value,
        turnId,
        correlationId: must(parseCorrelationId('corr-ttl-24h')),
        outputDigest: view2.payloadDigest,
        expiresAt: must(
          parseISO8601(new Date(Date.now() + OFFLINE_OUTBOX_MAX_TTL_MS).toISOString()),
        ),
      },
      ctx(),
    );
    expect(at24h.ok && at24h.value.kind === 'stored').toBe(true);

    const sealed3 = sealValidatedTextOutput({ source: 'llm', text: 'ttl-safe-text-3' });
    if (!sealed3.ok) throw new Error('seal3');
    const view3 = getValidatedTextOutputView(sealed3.value);
    if (view3 === null) throw new Error('view3');
    const over24h = await handle.outbox.put(
      {
        output: sealed3.value,
        principal: principal.value,
        turnId,
        correlationId: must(parseCorrelationId('corr-ttl-over')),
        outputDigest: view3.payloadDigest,
        expiresAt: must(
          parseISO8601(new Date(Date.now() + OFFLINE_OUTBOX_MAX_TTL_MS + 1).toISOString()),
        ),
      },
      ctx(),
    );
    expect(over24h.ok && over24h.value.kind === 'rejected').toBe(true);

    handle.close();
    root.close();
  });

  it('enforces queue-full and global-queue-full', async () => {
    const depth = openWith({
      queueConfig: Object.freeze({ maxDepthPerConversation: 2, maxGlobalPending: 64 }),
    });
    const first = await admitTurn(depth.handle, 'qf1', {
      ownerId: 'owner-1',
      conversationId: 'conversation-1',
    });
    expect(first.accepted.ok && first.accepted.value.kind === 'accepted').toBe(true);
    const second = await admitTurn(depth.handle, 'qf2', {
      ownerId: 'owner-1',
      conversationId: 'conversation-1',
    });
    expect(second.accepted.ok && second.accepted.value.kind === 'accepted').toBe(true);
    const third = await admitTurn(depth.handle, 'qf3', {
      ownerId: 'owner-1',
      conversationId: 'conversation-1',
    });
    expect(third.accepted.ok && third.accepted.value.kind === 'queue-full').toBe(true);
    depth.handle.close();
    depth.root.close();

    const global = openWith({
      queueConfig: Object.freeze({ maxDepthPerConversation: 8, maxGlobalPending: 1 }),
    });
    const g1 = await admitTurn(global.handle, 'gq1', {
      ownerId: 'owner-1',
      conversationId: 'conversation-a',
    });
    expect(g1.accepted.ok && g1.accepted.value.kind === 'accepted').toBe(true);
    const g2 = await admitTurn(global.handle, 'gq2', {
      ownerId: 'owner-1',
      conversationId: 'conversation-b',
    });
    expect(g2.accepted.ok && g2.accepted.value.kind === 'global-queue-full').toBe(true);
    global.handle.close();
    global.root.close();
  });

  it('rejects invalid queueConfig before publishing ports', () => {
    const storageRoot = createTempStorageRoot();
    const root = openGenuineRoot(storageRoot);
    const cases: unknown[] = [
      { maxDepthPerConversation: 1, maxGlobalPending: 1 },
      { maxDepthPerConversation: 8, maxGlobalPending: 0 },
      { maxDepthPerConversation: 8.5, maxGlobalPending: 1 },
      { maxDepthPerConversation: Number.NaN, maxGlobalPending: 1 },
      { maxDepthPerConversation: 8, maxGlobalPending: Number.POSITIVE_INFINITY },
      {
        get maxDepthPerConversation() {
          return 8;
        },
        maxGlobalPending: 1,
      },
    ];
    for (const queueConfig of cases) {
      const opened = createOfflineSqliteCommunicationPorts(root, {
        scanner: fakeSensitiveDataScanner('allow'),
        queueConfig: queueConfig as CommunicationQueueConfig,
      });
      expect(opened.ok).toBe(false);
      if (!opened.ok && 'error' in opened) {
        expect(opened.error.code).toBe('SQLITE_OPEN_FAILED');
        expect(opened.error.reason).toMatch(/queueConfig/i);
      }
    }
    expect(existsSync(`${storageRoot}/${SQLITE_COMMUNICATION_DATABASE_FILENAME}`)).toBe(false);
    root.close();
  });

  it('fails closed on column and index tamper', () => {
    const storageRoot = createTempStorageRoot();
    const dbPath = `${storageRoot}/${SQLITE_COMMUNICATION_DATABASE_FILENAME}`;
    mkdirSync(storageRoot, { recursive: true });
    const db = openSqliteDatabaseFile(dbPath);
    migrateCommunicationSchema0To1(db);
    db.exec(`ALTER TABLE turns ADD COLUMN evil_extra TEXT`);
    db.close();
    const root = openGenuineRoot(storageRoot);
    const columnTamper = createOfflineSqliteCommunicationPorts(root, {
      scanner: fakeSensitiveDataScanner('allow'),
      queueConfig: defaultQueue,
    });
    expect(columnTamper.ok).toBe(false);

    const db2 = openSqliteDatabaseFile(dbPath);
    // Rebuild clean schema then drop required index.
    db2.exec(`DROP TABLE IF EXISTS evil_cleanup`);
    db2.close();
    root.close();

    const storageRoot2 = createTempStorageRoot();
    const dbPath2 = `${storageRoot2}/${SQLITE_COMMUNICATION_DATABASE_FILENAME}`;
    mkdirSync(storageRoot2, { recursive: true });
    const clean = openSqliteDatabaseFile(dbPath2);
    migrateCommunicationSchema0To1(clean);
    clean.exec(`DROP INDEX turns_recovery_idx`);
    clean.close();
    const root2 = openGenuineRoot(storageRoot2);
    const indexTamper = createOfflineSqliteCommunicationPorts(root2, {
      scanner: fakeSensitiveDataScanner('allow'),
      queueConfig: defaultQueue,
    });
    expect(indexTamper.ok).toBe(false);
    root2.close();
  });

  it('rolls back migration failure without publishing partial schema', () => {
    const storageRoot = createTempStorageRoot();
    const root = openGenuineRoot(storageRoot);
    const opened = createOfflineSqliteCommunicationPortsWithTestHooks(
      root,
      { scanner: fakeSensitiveDataScanner('allow'), queueConfig: defaultQueue },
      {
        wrapDatabase: (db) => {
          const originalExec = db.exec.bind(db);
          db.exec = (sql: string) => {
            if (sql.includes('CREATE TABLE factual_history'))
              throw new Error('injected migration failure');
            return originalExec(sql);
          };
          return db;
        },
      },
    );
    expect(opened.ok).toBe(false);
    const dbPath = `${storageRoot}/${SQLITE_COMMUNICATION_DATABASE_FILENAME}`;
    expect(existsSync(dbPath)).toBe(true);
    const inspect = openSqliteDatabaseFile(dbPath);
    expect(isSqliteDatabaseEmpty(inspect)).toBe(true);
    expect(listSqliteUserSchemaInventory(inspect)).toEqual([]);
    inspect.close();
    root.close();
  });

  it('serializes concurrent duplicate admission across two handles', async () => {
    const storageRoot = createTempStorageRoot();
    const root = openGenuineRoot(storageRoot);
    const first = createOfflineSqliteCommunicationPorts(root, {
      scanner: fakeSensitiveDataScanner('allow'),
      queueConfig: defaultQueue,
    });
    const second = createOfflineSqliteCommunicationPorts(root, {
      scanner: fakeSensitiveDataScanner('allow'),
      queueConfig: defaultQueue,
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('open');
    const command = {
      idempotencyKey: must(parseCommunicationIdempotencyKey(hex64('concurrent'))),
      transportInstanceId: must(parseTransportInstanceId('transport-concurrent')),
      turnId: must(parseTurnId('turn-concurrent')),
      observedAt: must(parseISO8601('2026-08-05T12:00:00.000Z')),
    };
    const [a, b] = await Promise.all([
      first.value.ledger.observeTransportEvent(command, ctx()),
      second.value.ledger.observeTransportEvent(command, ctx()),
    ]);
    const kinds = [a, b].map((result) => {
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('observe');
      return result.value.kind;
    });
    expect(kinds.sort()).toEqual(['duplicate-existing', 'fresh-observed'].sort());
    const db = openSqliteDatabaseFile(`${storageRoot}/${SQLITE_COMMUNICATION_DATABASE_FILENAME}`);
    const turnCount = db.prepare(`SELECT COUNT(*) AS n FROM turns`).get() as { n: number };
    const dedupCount = db.prepare(`SELECT COUNT(*) AS n FROM turn_dedup`).get() as { n: number };
    const sequenceCount = db.prepare(`SELECT COUNT(*) AS n FROM sequence_counters`).get() as {
      n: number;
    };
    expect(turnCount.n).toBe(1);
    expect(dedupCount.n).toBe(1);
    expect(sequenceCount.n).toBe(0);
    db.close();
    first.value.close();
    second.value.close();
    root.close();
  });

  it('rejects checkpoint fingerprint conflicts and non-zero initial expectedRevision', async () => {
    const { handle, root } = openWith();
    const owner = must(parseOwnerId('owner-1'));
    const conversation = must(parseConversationId('conversation-1'));
    const rev0 = must(parseConversationRevision(0));
    const rev1 = must(parseConversationRevision(1));
    const rev5 = must(parseConversationRevision(5));
    const snapshotA = freezeConversationStateSnapshot({
      conversationId: conversation,
      ownerId: owner,
      revision: rev1,
      activeContext: [
        Object.freeze({ role: 'owner' as const, text: 'alpha', trust: 'untrusted' as const }),
      ],
      modelDerivedSummary: null,
      pauseState: 'active',
      checkpoint: Object.freeze({ status: 'pending' as const, revision: rev1 }),
    });
    const snapshotB = freezeConversationStateSnapshot({
      conversationId: conversation,
      ownerId: owner,
      revision: rev1,
      activeContext: [
        Object.freeze({ role: 'owner' as const, text: 'beta', trust: 'untrusted' as const }),
      ],
      modelDerivedSummary: null,
      pauseState: 'active',
      checkpoint: Object.freeze({ status: 'pending' as const, revision: rev1 }),
    });

    const rejectedInitial = await handle.conversationState.checkpoint(
      {
        key: { ownerId: owner, conversationId: conversation },
        expectedRevision: rev5,
        nextSnapshot: freezeConversationStateSnapshot({
          ...snapshotA,
          revision: rev5,
          checkpoint: Object.freeze({ status: 'pending' as const, revision: rev5 }),
        }),
        correlationId: must(parseCorrelationId('corr-init')),
        idempotencyKey: 'initial-nonzero',
      },
      ctx(),
    );
    expect(rejectedInitial.ok && rejectedInitial.value.kind === 'stale-revision').toBe(true);

    const first = await handle.conversationState.checkpoint(
      {
        key: { ownerId: owner, conversationId: conversation },
        expectedRevision: rev0,
        nextSnapshot: snapshotA,
        correlationId: must(parseCorrelationId('corr-fp')),
        idempotencyKey: 'checkpoint-fp',
      },
      ctx(),
    );
    expect(first.ok && first.value.kind === 'stored').toBe(true);
    const conflict = await handle.conversationState.checkpoint(
      {
        key: { ownerId: owner, conversationId: conversation },
        expectedRevision: rev1,
        nextSnapshot: snapshotB,
        correlationId: must(parseCorrelationId('corr-fp')),
        idempotencyKey: 'checkpoint-fp',
      },
      ctx(),
    );
    expect(conflict.ok && conflict.value.kind === 'unavailable').toBe(true);
    if (conflict.ok && conflict.value.kind === 'unavailable')
      expect(conflict.value.reason).toMatch(/fingerprint/i);
    handle.close();
    root.close();
  });

  it('keeps delivered, delivery outcome unknown, and LLM outcome unknown immutable with append-only history', async () => {
    const { handle, root, storageRoot } = openWith();
    const admitted = await admitTurn(handle, 'imm', {
      ownerId: 'owner-1',
      conversationId: 'conversation-1',
    });
    expect(admitted.accepted.ok && admitted.accepted.value.kind === 'accepted').toBe(true);
    if (!admitted.accepted.ok || admitted.accepted.value.kind !== 'accepted')
      throw new Error('accept');
    let revision = admitted.accepted.value.turnRevision;
    const correlationId = must(parseCorrelationId('corr-imm'));

    const llmUnknown = await handle.ledger.recordFactualOutcome(
      {
        turnId: admitted.turnId,
        correlationId,
        expectedRevision: revision,
        llmOutcome: 'outcome-unknown',
        deliveryStatus: 'not_started',
        checkpointStatus: 'not_required',
        auditStatus: { start: 'pending', completion: 'not_started' },
        errorCode: null,
      },
      ctx(),
    );
    expect(llmUnknown.ok && llmUnknown.value.kind === 'recorded').toBe(true);
    if (!llmUnknown.ok || llmUnknown.value.kind !== 'recorded') throw new Error('llm');
    revision = llmUnknown.value.turnRevision;
    const llmRewrite = await handle.ledger.recordFactualOutcome(
      {
        turnId: admitted.turnId,
        correlationId,
        expectedRevision: revision,
        llmOutcome: 'completed',
        deliveryStatus: 'not_started',
        checkpointStatus: 'not_required',
        auditStatus: { start: 'pending', completion: 'not_started' },
        errorCode: null,
      },
      ctx(),
    );
    expect(llmRewrite.ok && llmRewrite.value.kind === 'fact-rewrite-denied').toBe(true);

    const deliveryUnknown = await handle.ledger.recordFactualOutcome(
      {
        turnId: admitted.turnId,
        correlationId,
        expectedRevision: revision,
        llmOutcome: 'outcome-unknown',
        deliveryStatus: 'outcome_unknown',
        checkpointStatus: 'not_required',
        auditStatus: { start: 'pending', completion: 'not_started' },
        errorCode: null,
      },
      ctx(),
    );
    expect(deliveryUnknown.ok && deliveryUnknown.value.kind === 'recorded').toBe(true);
    if (!deliveryUnknown.ok || deliveryUnknown.value.kind !== 'recorded') throw new Error('du');
    revision = deliveryUnknown.value.turnRevision;
    const deliveryRewrite = await handle.ledger.recordFactualOutcome(
      {
        turnId: admitted.turnId,
        correlationId,
        expectedRevision: revision,
        llmOutcome: 'outcome-unknown',
        deliveryStatus: 'delivered',
        checkpointStatus: 'not_required',
        auditStatus: { start: 'pending', completion: 'not_started' },
        errorCode: null,
      },
      ctx(),
    );
    expect(deliveryRewrite.ok && deliveryRewrite.value.kind === 'fact-rewrite-denied').toBe(true);

    // Separate turn for delivered immutability (outcome_unknown blocks delivered transition).
    const deliveredTurn = await admitTurn(handle, 'imm2', {
      ownerId: 'owner-1',
      conversationId: 'conversation-1',
    });
    expect(deliveredTurn.accepted.ok && deliveredTurn.accepted.value.kind === 'accepted').toBe(
      true,
    );
    if (!deliveredTurn.accepted.ok || deliveredTurn.accepted.value.kind !== 'accepted')
      throw new Error('accept2');
    const delivered = await handle.ledger.recordFactualOutcome(
      {
        turnId: deliveredTurn.turnId,
        correlationId: must(parseCorrelationId('corr-imm2')),
        expectedRevision: deliveredTurn.accepted.value.turnRevision,
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
    const deliveredRewrite = await handle.ledger.recordFactualOutcome(
      {
        turnId: deliveredTurn.turnId,
        correlationId: must(parseCorrelationId('corr-imm2')),
        expectedRevision: delivered.value.turnRevision,
        llmOutcome: 'completed',
        deliveryStatus: 'failed',
        checkpointStatus: 'succeeded',
        auditStatus: { start: 'succeeded', completion: 'succeeded' },
        errorCode: null,
      },
      ctx(),
    );
    expect(deliveredRewrite.ok && deliveredRewrite.value.kind === 'fact-rewrite-denied').toBe(true);

    handle.close();
    const db = openSqliteDatabaseFile(`${storageRoot}/${SQLITE_COMMUNICATION_DATABASE_FILENAME}`);
    const history = db
      .prepare(`SELECT turn_id, llm_outcome, delivery_status FROM factual_history ORDER BY id ASC`)
      .all() as Array<{ turn_id: string; llm_outcome: string | null; delivery_status: string }>;
    expect(history.length).toBeGreaterThanOrEqual(3);
    expect(history.some((row) => row.llm_outcome === 'outcome-unknown')).toBe(true);
    expect(history.some((row) => row.delivery_status === 'outcome_unknown')).toBe(true);
    expect(
      history.some(
        (row) => row.turn_id === deliveredTurn.turnId && row.delivery_status === 'delivered',
      ),
    ).toBe(true);
    expect(
      history.some(
        (row) => row.turn_id === deliveredTurn.turnId && row.delivery_status === 'failed',
      ),
    ).toBe(false);
    const live = db
      .prepare(`SELECT llm_outcome, delivery_status FROM turns WHERE turn_id = ?`)
      .get(admitted.turnId) as { llm_outcome: string; delivery_status: string };
    expect(live.llm_outcome).toBe('outcome-unknown');
    expect(live.delivery_status).toBe('outcome_unknown');
    db.close();
    root.close();
  });
});
