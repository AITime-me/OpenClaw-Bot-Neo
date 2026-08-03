import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { executeMemoryWrite } from '../src/core/application/memory-write.service.js';
import { ok } from '../src/core/domain/index.js';
import { scanSensitiveData } from '../src/core/policy/sensitive-data-scanner.js';
import {
  isSecretData,
  isSecretReference,
  readSecretMaterialForTrustedConsumer,
  sealSecretData,
  sealSecretReference,
} from '../src/core/domain/secret.internal.js';
import {
  sealSanitizedMetadata,
  sealSanitizedText,
  sealVerifiedMemoryWrite,
  issueSecretBoundaryClearance,
  verifiedMemoryWriteHasClearance,
} from '../src/core/domain/sanitized.internal.js';
import { verifiedMemoryWriteHasSecretBoundaryClearance } from '../src/core/domain/verified-memory-write-guard.js';
import type { SecretsPort } from '../src/core/ports/secrets.port.js';
import { createInMemoryMemoryStore, createLocalHost } from '../src/host/index.js';
import { createExplicitAllowMemoryPolicy } from '../src/host/in-memory/memory-policy.js';
import {
  applySqliteMemoryPragmas,
  bootstrapSqliteMemorySchemaV1,
  MEMORY_RECORDS_TABLE,
} from '../src/host/storage/sqlite/sqlite-memory-schema.js';
import { createSqliteMemoryPortConnection } from '../src/host/storage/sqlite/sqlite-memory-port.js';
import * as publicApi from '../src/index.js';
import {
  asOwner,
  asRecordId,
  authenticatedAccess,
  createHarness,
  fixedClock,
  ownerSource,
  retentionPolicy,
  verifiedMemoryWriteForTests,
  writeCommand,
  iso,
  NOW,
} from './support/fixtures.js';

/** Synthetic credential-shaped value unknown to current scanner literal/assignment detectors. */
const SYNTHETIC_UNKNOWN_SECRET = 'syn-cred-v0:zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz';

const require = createRequire(import.meta.url);
const DatabaseCtor = require('better-sqlite3') as typeof import('better-sqlite3');

const writeBindingFixture = (
  overrides: {
    readonly recordId?: string;
    readonly content?: string;
    readonly metadata?: Readonly<Record<string, string>>;
    readonly namespace?: 'personal' | 'shared-public' | 'security-restricted';
  } = {},
) => {
  const ownerId = asOwner();
  const content = sealSanitizedText(overrides.content ?? 'note-body', 'allow');
  const metadata = sealSanitizedMetadata(overrides.metadata ?? { origin: 'test' }, 'allow');
  return {
    recordId: asRecordId(overrides.recordId ?? 'record-binding'),
    ownerId,
    namespace: overrides.namespace ?? ('personal' as const),
    content,
    metadata,
    source: ownerSource(),
    provenance: {
      capturedAt: iso(NOW),
      initiatedBy: ownerId,
      transformation: 'owner-stated' as const,
      ownerApproved: false,
      crossProjectAccess: false,
    },
    privacyClassification: 'confidential' as const,
    trustLevel: 'owner-stated' as const,
    retentionPolicy: retentionPolicy(),
    approvalId: null,
    createdAt: iso(NOW),
    updatedAt: iso(NOW),
  };
};

describe('R6-H02 secret boundary', () => {
  it('returns scanner allow for the synthetic unknown-format value', () => {
    const scan = scanSensitiveData(SYNTHETIC_UNKNOWN_SECRET);
    expect(scan.ok).toBe(true);
    if (!scan.ok) return;
    expect(scan.value.decision).toBe('allow');
    expect(scan.value.findings).toHaveLength(0);
  });

  it('rejects scanner-unknown but secret-provenance content before product policy', async () => {
    const harness = createHarness({ policyDecision: { decision: 'allow' } });
    const result = await executeMemoryWrite(
      harness.deps,
      authenticatedAccess(),
      writeCommand({
        rawContent: SYNTHETIC_UNKNOWN_SECRET,
        contentSensitivity: 'secret-class',
      }),
    );
    expect(result).toEqual({ ok: false, error: { code: 'SECRET_CLASS_DENIED' } });
    expect(harness.calls).toEqual([]);
    expect(harness.calls).not.toContain('policy.evaluate');
    expect(harness.writes).toHaveLength(0);
    expect(harness.auditEvents).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain(SYNTHETIC_UNKNOWN_SECRET);
  });

  it('keeps scanner-recognized credential denial before product policy', async () => {
    const harness = createHarness({ policyDecision: { decision: 'allow' } });
    const result = await executeMemoryWrite(
      harness.deps,
      authenticatedAccess(),
      writeCommand({ rawContent: 'api_key=zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('SCAN_DENIED');
    expect(harness.calls).not.toContain('policy.evaluate');
    expect(harness.writes).toHaveLength(0);
  });

  it('allows ordinary personal text through permissive product policy', async () => {
    const harness = createHarness({ policyDecision: { decision: 'allow' } });
    const result = await executeMemoryWrite(harness.deps, authenticatedAccess(), writeCommand());
    expect(result.ok).toBe(true);
    expect(harness.calls).toContain('policy.evaluate');
    expect(harness.writes).toHaveLength(1);
    const firstWrite = harness.writes[0];
    expect(firstWrite).toBeDefined();
    if (firstWrite === undefined) return;
    expect(verifiedMemoryWriteHasSecretBoundaryClearance(firstWrite)).toBe(true);
  });

  it('rejects nested SecretData in metadata without leaking material', async () => {
    const secret = sealSecretData('nested-synthetic-material');
    const harness = createHarness({ policyDecision: { decision: 'allow' } });
    const result = await executeMemoryWrite(
      harness.deps,
      authenticatedAccess(),
      writeCommand({ rawMetadata: { nested: { token: secret } } }),
    );
    expect(result).toEqual({ ok: false, error: { code: 'SECRET_CLASS_DENIED' } });
    expect(JSON.stringify(result)).not.toContain('nested-synthetic-material');
    expect(harness.writes).toHaveLength(0);
  });

  it('rejects forged verified writes without mandatory clearance in in-memory sink', async () => {
    const memory = createInMemoryMemoryStore();
    const access = authenticatedAccess();
    const forgedClearance = { kind: 'secret-boundary-clearance' };
    const withoutClearance = sealVerifiedMemoryWrite(
      writeBindingFixture({ content: 'note' }),
      forgedClearance as never,
    );
    expect(withoutClearance).toBeNull();

    const binding = writeBindingFixture({ recordId: 'record-cleared', content: 'note' });
    const clearance = issueSecretBoundaryClearance(binding);
    expect(clearance).not.toBeNull();
    if (clearance === null) return;
    const cleared = sealVerifiedMemoryWrite(binding, clearance);
    expect(cleared).not.toBeNull();
    if (cleared === null) return;
    const structural = { ...cleared };
    const written = await memory.write(structural, access);
    expect(written.ok).toBe(false);
    if (written.ok) return;
    expect(written.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('R6-H02 clearance binding and single-use consumption', () => {
  it('seals write A once with clearance bound to write A', () => {
    const binding = writeBindingFixture();
    const clearance = issueSecretBoundaryClearance(binding);
    expect(clearance).not.toBeNull();
    if (clearance === null) return;
    const write = sealVerifiedMemoryWrite(binding, clearance);
    expect(write).not.toBeNull();
    expect(verifiedMemoryWriteHasClearance(write)).toBe(true);
  });

  it('rejects sealing write A twice with the same clearance', () => {
    const binding = writeBindingFixture();
    const clearance = issueSecretBoundaryClearance(binding);
    expect(clearance).not.toBeNull();
    if (clearance === null) return;
    expect(sealVerifiedMemoryWrite(binding, clearance)).not.toBeNull();
    expect(sealVerifiedMemoryWrite(binding, clearance)).toBeNull();
  });

  it('rejects clearance for write A sealing write B', () => {
    const bindingA = writeBindingFixture({ recordId: 'record-a' });
    const bindingB = writeBindingFixture({ recordId: 'record-b' });
    const clearance = issueSecretBoundaryClearance(bindingA);
    expect(clearance).not.toBeNull();
    if (clearance === null) return;
    expect(sealVerifiedMemoryWrite(bindingB, clearance)).toBeNull();
  });

  it('rejects altered content during sealing without consuming clearance', () => {
    const binding = writeBindingFixture();
    const clearance = issueSecretBoundaryClearance(binding);
    expect(clearance).not.toBeNull();
    if (clearance === null) return;
    const altered = { ...binding, content: sealSanitizedText('different-body', 'allow') };
    expect(sealVerifiedMemoryWrite(altered, clearance)).toBeNull();
    expect(sealVerifiedMemoryWrite(binding, clearance)).not.toBeNull();
  });

  it('rejects altered metadata during sealing', () => {
    const binding = writeBindingFixture();
    const clearance = issueSecretBoundaryClearance(binding);
    expect(clearance).not.toBeNull();
    if (clearance === null) return;
    const altered = {
      ...binding,
      metadata: sealSanitizedMetadata({ origin: 'mutated' }, 'allow'),
    };
    expect(sealVerifiedMemoryWrite(altered, clearance)).toBeNull();
  });

  it('rejects altered namespace during sealing', () => {
    const binding = writeBindingFixture();
    const clearance = issueSecretBoundaryClearance(binding);
    expect(clearance).not.toBeNull();
    if (clearance === null) return;
    const altered = { ...binding, namespace: 'shared-public' as const };
    expect(sealVerifiedMemoryWrite(altered, clearance)).toBeNull();
  });

  it('rejects structurally forged clearance', () => {
    const binding = writeBindingFixture();
    expect(
      sealVerifiedMemoryWrite(binding, { kind: 'secret-boundary-clearance' } as never),
    ).toBeNull();
  });

  it('rejects spread/copied clearance tokens', () => {
    const binding = writeBindingFixture();
    const clearance = issueSecretBoundaryClearance(binding);
    expect(clearance).not.toBeNull();
    if (clearance === null) return;
    const copied = { ...clearance };
    expect(sealVerifiedMemoryWrite(binding, copied as never)).toBeNull();
  });

  it('rejects JSON round-tripped clearance tokens', () => {
    const binding = writeBindingFixture();
    const clearance = issueSecretBoundaryClearance(binding);
    expect(clearance).not.toBeNull();
    if (clearance === null) return;
    const deserialized = JSON.parse(JSON.stringify(clearance)) as never;
    expect(sealVerifiedMemoryWrite(binding, deserialized)).toBeNull();
  });

  it('rejects spread verified writes at the sink guard', async () => {
    const memory = createInMemoryMemoryStore();
    const access = authenticatedAccess();
    const write = verifiedMemoryWriteForTests();
    const copied = { ...write };
    const result = await memory.write(copied, access);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('R6-H02 SQLite missing-clearance rejection', () => {
  const openTracedMemoryPort = () => {
    const sqlEvents: string[] = [];
    const db = new DatabaseCtor(':memory:', {
      verbose: (message?: unknown) => {
        if (typeof message === 'string') sqlEvents.push(message);
      },
    });
    applySqliteMemoryPragmas(db);
    bootstrapSqliteMemorySchemaV1(db);
    const { memory } = createSqliteMemoryPortConnection(db, () => null);
    return { memory, db, sqlEvents };
  };

  const countRows = (db: import('better-sqlite3').Database): number => {
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${MEMORY_RECORDS_TABLE}`).get() as {
      count: number;
    };
    return row.count;
  };

  const mutatingPattern = /\b(BEGIN|INSERT|UPDATE|DELETE|COMMIT|ROLLBACK)\b/i;

  it('rejects uncleared verified write before any mutating SQL executes', async () => {
    const { memory, db, sqlEvents } = openTracedMemoryPort();
    const access = authenticatedAccess();
    const uncleared = Object.freeze({
      recordId: asRecordId('sqlite-uncleared'),
      ownerId: access.ownerId,
      namespace: 'personal' as const,
      content: sealSanitizedText('sqlite-synthetic-body', 'allow'),
      metadata: sealSanitizedMetadata({ origin: 'sqlite-test' }, 'allow'),
      source: ownerSource(),
      provenance: {
        capturedAt: iso(NOW),
        initiatedBy: access.ownerId,
        transformation: 'owner-stated' as const,
        ownerApproved: false,
        crossProjectAccess: false,
      },
      privacyClassification: 'confidential' as const,
      trustLevel: 'owner-stated' as const,
      retentionPolicy: retentionPolicy(),
      approvalId: null,
      createdAt: iso(NOW),
      updatedAt: iso(NOW),
    });

    sqlEvents.length = 0;
    const result = await memory.write(uncleared, access);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(result)).not.toContain('sqlite-synthetic-body');
    expect(sqlEvents.some((sql) => mutatingPattern.test(sql))).toBe(false);
    expect(countRows(db)).toBe(0);
  });

  it('persists cleared verified writes through SQLite', async () => {
    const { memory, db } = openTracedMemoryPort();
    const access = authenticatedAccess();
    const write = verifiedMemoryWriteForTests({ content: 'cleared-sqlite-body' });
    const result = await memory.write(write, access);
    expect(result.ok).toBe(true);
    expect(countRows(db)).toBe(1);
  });
});

describe('opaque secret primitives', () => {
  it('seals SecretData without useful string conversion', () => {
    const secret = sealSecretData('synthetic-material-value');
    expect(isSecretData(secret)).toBe(true);
    const toString = Object.getOwnPropertyDescriptor(secret, 'toString')?.value as
      (() => string) | undefined;
    expect(toString?.call(secret)).toBe('[opaque-secret]');
    expect(isSecretData({ kind: 'secret-data' })).toBe(false);
    expect(readSecretMaterialForTrustedConsumer(secret)).toBe('synthetic-material-value');
  });

  it('seals SecretReference without material', () => {
    const reference = sealSecretReference('ref-001', 'synthetic-provider');
    expect(isSecretReference(reference)).toBe(true);
    const toString = Object.getOwnPropertyDescriptor(reference, 'toString')?.value as
      (() => string) | undefined;
    expect(toString?.call(reference)).toBe('[opaque-secret]');
    expect(reference.referenceId).toBe('ref-001');
  });

  it('types SecretsPort resolve as opaque SecretData', async () => {
    const port: SecretsPort = {
      resolve: () => Promise.resolve(ok(sealSecretData('lease-material'))),
    };
    const resolved = await port.resolve('ref', {
      signal: new AbortController().signal,
      timeoutMs: 1_000,
      deadline: '2026-07-01T12:00:30.000Z' as never,
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(isSecretData(resolved.value)).toBe(true);
    expect(typeof (resolved.value as unknown as string)).not.toBe('string');
  });

  it('keeps secret seal helpers off the package root', () => {
    const names = Object.keys(publicApi);
    for (const forbidden of [
      'sealSecretData',
      'issueSecretBoundaryClearance',
      'readSecretMaterialForTrustedConsumer',
      'evaluateMemorySecretBoundary',
      'verifiedMemoryWriteHasSecretBoundaryClearance',
    ])
      expect(names).not.toContain(forbidden);
  });
});

describe('Neo deny-by-default compatibility', () => {
  it('keeps default local host memory policy deny-by-default', async () => {
    const host = createLocalHost({ clock: fixedClock() });
    const result = await host.writeMemory(authenticatedAccess(), writeCommand());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('POLICY_DENIED');
  });

  it('does not change explicit allow-policy behavior for ordinary non-secret text', async () => {
    const host = createLocalHost({
      clock: fixedClock(),
      policy: createExplicitAllowMemoryPolicy(),
    });
    const result = await host.writeMemory(authenticatedAccess(), writeCommand());
    expect(result.ok).toBe(true);
  });
});
