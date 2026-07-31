import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MEMORY_QUERY_LIMIT_MAX,
  MEMORY_QUERY_LIMIT_MIN,
  readMemoryQueryLimit,
  type MemoryNamespace,
  type MemoryQueryRequest,
  type VerifiedMemoryWrite,
} from '../src/core/domain/index.js';
import {
  sealSanitizedMetadata,
  sealSanitizedText,
  sealVerifiedMemoryWrite,
} from '../src/core/domain/sanitized.internal.js';
import { createInMemoryMemoryStore } from '../src/host/index.js';
import {
  asOwner,
  asRecordId,
  authenticatedAccess,
  iso,
  NOW,
  ownerSource,
  retentionPolicy,
} from './support/fixtures.js';

const listTsFiles = (root: string): string[] => {
  const files: string[] = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) files.push(...listTsFiles(path));
    else if (name.endsWith('.ts')) files.push(path.replaceAll('\\', '/'));
  }
  return files;
};

const verifiedWrite = (overrides: {
  readonly recordId?: string;
  readonly ownerId?: string;
  readonly namespace?: MemoryNamespace;
  readonly content?: string;
}): VerifiedMemoryWrite => {
  const write = sealVerifiedMemoryWrite({
    recordId: asRecordId(overrides.recordId ?? 'record-1'),
    ownerId: asOwner(overrides.ownerId ?? 'owner-1'),
    namespace: overrides.namespace ?? 'personal',
    content: sealSanitizedText(overrides.content ?? 'note-body', 'allow'),
    metadata: sealSanitizedMetadata({ origin: 'test' }, 'allow'),
    source: ownerSource(),
    provenance: {
      capturedAt: iso(NOW),
      initiatedBy: asOwner(overrides.ownerId ?? 'owner-1'),
      transformation: 'owner-stated',
      ownerApproved: false,
      crossProjectAccess: false,
    },
    privacyClassification: 'confidential',
    trustLevel: 'owner-stated',
    retentionPolicy: retentionPolicy(),
    approvalId: null,
    createdAt: iso(NOW),
    updatedAt: iso(NOW),
  });
  if (write === null) throw new Error('failed to seal verified write');
  return write;
};

const queryRequest = (
  overrides: Partial<MemoryQueryRequest> & { readonly limit: number },
): MemoryQueryRequest => ({
  query: 'ignored-search-term',
  targetNamespace: 'personal',
  expectedOwnerId: asOwner(),
  ...overrides,
});

describe('MEMORY_QUERY_LIMIT constants', () => {
  it('exports the owner-approved inclusive range', () => {
    expect(MEMORY_QUERY_LIMIT_MIN).toBe(1);
    expect(MEMORY_QUERY_LIMIT_MAX).toBe(100);
  });
});

describe('readMemoryQueryLimit validation', () => {
  it.each([1, 100, 50])('accepts limit=%s', (limit) => {
    const result = readMemoryQueryLimit({ limit });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(limit);
  });

  it.each([
    ['missing', {}],
    ['undefined', { limit: undefined }],
    ['null', { limit: null }],
    ['zero', { limit: 0 }],
    ['negative', { limit: -1 }],
    ['above max', { limit: 101 }],
    ['fractional', { limit: 1.5 }],
    ['NaN', { limit: Number.NaN }],
    ['Infinity', { limit: Number.POSITIVE_INFINITY }],
    ['-Infinity', { limit: Number.NEGATIVE_INFINITY }],
    ['string', { limit: '10' }],
    ['boolean', { limit: true }],
    ['unsafe integer', { limit: Number.MAX_SAFE_INTEGER + 1 }],
  ])('rejects %s without coercion or clamping', (_label, input) => {
    const result = readMemoryQueryLimit(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_FAILED');
    if (result.error.code !== 'VALIDATION_FAILED') return;
    expect(result.error.reason).toBe('Memory query limit is invalid.');
    expect(JSON.stringify(result.error)).not.toMatch(/owner-a|tvoe-vremya|needle/i);
  });

  it('rejects non-object containers', () => {
    expect(readMemoryQueryLimit(null).ok).toBe(false);
    expect(readMemoryQueryLimit(undefined).ok).toBe(false);
    expect(readMemoryQueryLimit(10).ok).toBe(false);
    expect(readMemoryQueryLimit('10').ok).toBe(false);
  });

  it('does not invoke limit getters', () => {
    let getterCalls = 0;
    const input: Record<string, unknown> = {};
    Object.defineProperty(input, 'limit', {
      enumerable: true,
      configurable: true,
      get() {
        getterCalls += 1;
        throw new Error('getter-must-not-run');
      },
    });
    const result = readMemoryQueryLimit(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(getterCalls).toBe(0);
  });

  it('rejects Proxy containers before traps run', () => {
    const traps = {
      get: 0,
      getOwnPropertyDescriptor: 0,
      ownKeys: 0,
      has: 0,
    };
    const proxy = new Proxy(
      { limit: 10 },
      {
        get(...args: Parameters<Required<ProxyHandler<object>>['get']>): unknown {
          traps.get += 1;
          return Reflect.get(...args);
        },
        getOwnPropertyDescriptor(
          ...args: Parameters<Required<ProxyHandler<object>>['getOwnPropertyDescriptor']>
        ): PropertyDescriptor | undefined {
          traps.getOwnPropertyDescriptor += 1;
          return Reflect.getOwnPropertyDescriptor(...args);
        },
        ownKeys(
          ...args: Parameters<Required<ProxyHandler<object>>['ownKeys']>
        ): ArrayLike<string | symbol> {
          traps.ownKeys += 1;
          return Reflect.ownKeys(...args);
        },
        has(...args: Parameters<Required<ProxyHandler<object>>['has']>): boolean {
          traps.has += 1;
          return Reflect.has(...args);
        },
      },
    );
    const result = readMemoryQueryLimit(proxy);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED');
    expect(traps).toEqual({ get: 0, getOwnPropertyDescriptor: 0, ownKeys: 0, has: 0 });
  });
});

describe('in-memory MemoryPort.query limit ceiling', () => {
  it('returns empty frozen array when no records match', async () => {
    const store = createInMemoryMemoryStore();
    const access = authenticatedAccess();
    const result = await store.query(queryRequest({ limit: 10 }), access);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
    expect(Object.isFrozen(result.value)).toBe(true);
  });

  it('returns all matches when fewer than limit', async () => {
    const store = createInMemoryMemoryStore();
    const access = authenticatedAccess();
    await store.write(verifiedWrite({ recordId: 'a' }), access);
    await store.write(verifiedWrite({ recordId: 'b' }), access);
    const result = await store.query(queryRequest({ limit: 10 }), access);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((record) => String(record.id))).toEqual(['a', 'b']);
  });

  it('returns exactly limit when matches equal limit', async () => {
    const store = createInMemoryMemoryStore();
    const access = authenticatedAccess();
    await store.write(verifiedWrite({ recordId: 'a' }), access);
    await store.write(verifiedWrite({ recordId: 'b' }), access);
    const result = await store.query(queryRequest({ limit: 2 }), access);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
  });

  it('caps results when matches exceed limit', async () => {
    const store = createInMemoryMemoryStore();
    const access = authenticatedAccess();
    for (const id of ['a', 'b', 'c', 'd']) {
      await store.write(verifiedWrite({ recordId: id }), access);
    }
    const result = await store.query(queryRequest({ limit: 2 }), access);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((record) => String(record.id))).toEqual(['a', 'b']);
  });

  it('accepts limit=1 and limit=100 boundaries on the store path', async () => {
    const store = createInMemoryMemoryStore();
    const access = authenticatedAccess();
    await store.write(verifiedWrite({ recordId: 'only' }), access);
    const one = await store.query(queryRequest({ limit: 1 }), access);
    expect(one.ok).toBe(true);
    if (!one.ok) return;
    expect(one.value).toHaveLength(1);

    for (let index = 0; index < 5; index += 1) {
      await store.write(verifiedWrite({ recordId: `bulk-${String(index)}` }), access);
    }
    const hundred = await store.query(queryRequest({ limit: 100 }), access);
    expect(hundred.ok).toBe(true);
    if (!hundred.ok) return;
    expect(hundred.value.length).toBeLessThanOrEqual(100);
    expect(hundred.value.length).toBe(6);
  });

  it('preserves insertion order and keeps overwrite position', async () => {
    const store = createInMemoryMemoryStore();
    const access = authenticatedAccess();
    await store.write(verifiedWrite({ recordId: 'first', content: 'v1' }), access);
    await store.write(verifiedWrite({ recordId: 'second', content: 'v2' }), access);
    await store.write(verifiedWrite({ recordId: 'third', content: 'v3' }), access);
    await store.write(verifiedWrite({ recordId: 'second', content: 'v2-updated' }), access);

    const result = await store.query(queryRequest({ limit: 10 }), access);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((record) => `${String(record.id)}:${record.content}`)).toEqual([
      'first:v1',
      'second:v2-updated',
      'third:v3',
    ]);
  });

  it('isolates owners and namespaces in the limited window', async () => {
    const store = createInMemoryMemoryStore();
    const ownerA = authenticatedAccess({ ownerId: 'owner-a' });
    const ownerB = authenticatedAccess({ ownerId: 'owner-b' });
    await store.write(
      verifiedWrite({ recordId: 'a-only', ownerId: 'owner-a', content: 'a' }),
      ownerA,
    );
    await store.write(
      verifiedWrite({ recordId: 'b-only', ownerId: 'owner-b', content: 'b' }),
      ownerB,
    );
    const otherNsAccess = authenticatedAccess({
      ownerId: 'owner-a',
      activeNamespace: 'tvoe-vremya',
      projectScope: {
        primary: 'tvoe-vremya',
        permitted: ['tvoe-vremya'],
        crossProjectPermitted: false,
      },
    });
    await store.write(
      verifiedWrite({
        recordId: 'ns-other',
        ownerId: 'owner-a',
        namespace: 'tvoe-vremya',
        content: 'other-ns',
      }),
      otherNsAccess,
    );

    const result = await store.query(
      queryRequest({
        limit: 10,
        expectedOwnerId: asOwner('owner-a'),
        targetNamespace: 'personal',
      }),
      ownerA,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.content).toBe('a');
    expect(result.value.every((record) => record.namespace === 'personal')).toBe(true);
  });

  it('ignores the query string for selection', async () => {
    const store = createInMemoryMemoryStore();
    const access = authenticatedAccess();
    await store.write(verifiedWrite({ recordId: 'alpha', content: 'needle' }), access);
    await store.write(verifiedWrite({ recordId: 'beta', content: 'other' }), access);
    const result = await store.query(
      queryRequest({ limit: 10, query: 'needle-should-not-filter' }),
      access,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
  });

  it('rejects invalid limit after authorization on the store path', async () => {
    const store = createInMemoryMemoryStore();
    const access = authenticatedAccess();
    const result = await store.query(queryRequest({ limit: 0 }), access);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_FAILED');
    if (result.error.code !== 'VALIDATION_FAILED') return;
    expect(result.error.reason).toBe('Memory query limit is invalid.');
  });

  it('returns frozen records that do not alias mutable inputs', async () => {
    const store = createInMemoryMemoryStore();
    const access = authenticatedAccess();
    const mutableContent = { value: 'stable-content' };
    await store.write(
      verifiedWrite({ recordId: 'frozen-1', content: mutableContent.value }),
      access,
    );
    mutableContent.value = 'mutated-after-write';

    const result = await store.query(queryRequest({ limit: 1 }), access);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value[0])).toBe(true);
    expect(Object.isFrozen(result.value[0]?.source)).toBe(true);
    expect(result.value[0]?.content).toBe('stable-content');
    expect(() => {
      (result.value as unknown as { push(value: unknown): number }).push(result.value[0]);
    }).toThrow();
    expect(() => {
      (result.value[0] as { content: string }).content = 'hacked';
    }).toThrow();
  });
});

describe('Build 3.3B2A regression', () => {
  it('does not change read/write/delete happy-path semantics', async () => {
    const store = createInMemoryMemoryStore();
    const access = authenticatedAccess();
    const written = await store.write(verifiedWrite({ recordId: 'rw-1', content: 'body' }), access);
    expect(written.ok).toBe(true);

    const read = await store.read(
      {
        recordId: asRecordId('rw-1'),
        expectedOwnerId: access.ownerId,
        expectedNamespace: 'personal',
      },
      access,
    );
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.content).toBe('body');

    const deleted = await store.delete(
      {
        recordId: asRecordId('rw-1'),
        expectedOwnerId: access.ownerId,
        expectedNamespace: 'personal',
        reason: 'test-cleanup',
      },
      access,
    );
    expect(deleted.ok).toBe(true);

    const missing = await store.read(
      {
        recordId: asRecordId('rw-1'),
        expectedOwnerId: access.ownerId,
        expectedNamespace: 'personal',
      },
      access,
    );
    expect(missing.ok).toBe(false);
  });

  it('keeps LocalHost on in-memory storage; only the dedicated driver imports better-sqlite3', () => {
    const hostSource = readFileSync('src/host/create-local-host.ts', 'utf8');
    expect(hostSource).toContain('createInMemoryMemoryStore');
    expect(hostSource).not.toMatch(/better-sqlite3|createSqliteMemoryPort|sqlite/i);

    const driver = 'src/host/storage/sqlite/better-sqlite3-driver.ts'.replaceAll('\\', '/');
    for (const file of listTsFiles('src')) {
      const normalized = file.replaceAll('\\', '/');
      const text = readFileSync(file, 'utf8');
      if (normalized.endsWith('/better-sqlite3-driver.ts')) {
        expect(text).toMatch(/better-sqlite3/);
        continue;
      }
      expect(text).not.toMatch(/from ['"]better-sqlite3['"]/);
      expect(text).not.toMatch(/require\(['"]better-sqlite3['"]\)/);
    }
    expect(driver.endsWith('better-sqlite3-driver.ts')).toBe(true);

    const publicApi = readFileSync('src/index.ts', 'utf8');
    expect(publicApi).not.toContain('readMemoryQueryLimit');
    expect(publicApi).not.toContain('MEMORY_QUERY_LIMIT');
    expect(publicApi).not.toContain('createSqliteMemoryPort');
  });
});
