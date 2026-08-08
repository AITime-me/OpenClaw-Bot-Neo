import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const BUILD_BASE = '7f3d69a37b1783429d27f1b9e0d5ce650c28e7cb';
const BUILD_SUBJECT = 'docs(communication): decide Build 3.7G0 encryption at-rest gate';

const CLOSEOUT_REL = 'docs/validation/build-3.7g0-communication-encryption-decisions.md';
const CLOSEOUT_PATH = join(REPO_ROOT, CLOSEOUT_REL);
const TEST_REL = 'tests/build-3.7g0-communication-encryption-decisions-record.test.ts';

const COMPANION_DOCS = [
  'docs/communication/text-implementation-map.md',
  'docs/communication/text-architecture.md',
  'docs/communication/text-trust-and-threat-model.md',
  'docs/acceptance-criteria.md',
] as const;

const ARCHITECTURE_PACKAGE_FILES = [CLOSEOUT_REL, TEST_REL, ...COMPANION_DOCS] as const;

const HISTORICAL_CLOSEOUTS = [
  'docs/validation/build-3.7a-text-communication-design-closeout.md',
  'docs/validation/build-3.7b-communication-contracts-closeout.md',
  'docs/validation/build-3.7c0-communication-persistence-decisions.md',
  'docs/validation/build-3.7c-communication-persistence-closeout.md',
  'docs/validation/build-3.7d0-communication-runtime-decisions.md',
  'docs/validation/build-3.7d-communication-runtime-closeout.md',
  'docs/validation/build-3.7e0-subscription-route-feasibility.md',
  'docs/validation/build-3.7e1a-codex-subscription-probe-decisions.md',
  'docs/validation/build-3.7e1-codex-subscription-probe-closeout.md',
] as const;

const ALLOWED_EXACT = new Set<string>(ARCHITECTURE_PACKAGE_FILES);

const FORBIDDEN_EXACT = [
  'package.json',
  'package-lock.json',
  '.env.example',
  'src/index.ts',
  'src/host/index.ts',
  'docs/security-policy.md',
  'docs/deployment.md',
] as const;

const FORBIDDEN_PREFIXES = ['src/', 'scripts/', 'deploy/'] as const;

const EXPECTED_MARKERS: ReadonlyArray<readonly [string, string]> = [
  ['BUILD_ID', '3.7G0'],
  ['BUILD_KIND', 'ARCHITECTURE_ONLY'],
  ['IMPLEMENTATION_STATUS', 'CONTRACTS_ONLY'],
  ['LIVE_ENCRYPTION', 'ARCHITECTURE_DECIDED'],
  ['ENCRYPTION_IMPLEMENTATION', 'ABSENT'],
  ['ENCRYPTION_ALGORITHM', 'AES_256_GCM_NODE_CRYPTO'],
  ['KEY_IN_SQLITE', 'FORBIDDEN'],
  ['KEY_SOURCE', 'NEO_COMMUNICATION_DATA_KEY_FILE'],
  ['SILENT_PLAINTEXT_FALLBACK', 'FORBIDDEN'],
  ['SCHEMA_V1_PLAINTEXT_OFFLINE', 'COMPATIBLE'],
  ['SCHEMA_V1_PLAINTEXT_LIVE', 'REJECTED'],
  ['MEMORY_COMMUNICATION_DB_MERGE', 'FORBIDDEN'],
  ['PACKAGE_ROOT_EXPORTS', 'ABSENT'],
  ['PRODUCTION_COMPOSITION', 'ABSENT'],
  ['PROVIDER_ADAPTER', 'ABSENT'],
  ['TELEGRAM_ADAPTER', 'ABSENT'],
  ['BUILD_3_7F_STATUS', 'BLOCKED'],
  ['DURABLE_LIVE_INTEGRATION', 'BLOCKED_PENDING_ENCRYPTION_IMPLEMENTATION'],
  ['PRODUCTION_READY', 'FALSE'],
  ['SECURITY_APPROVED', 'FALSE'],
  ['IMPLEMENTATION_READY', 'TRUE'],
  ['NEXT_STAGE', '3.7G_ENCRYPTION_IMPLEMENTATION'],
];

const EXPECTED_MARKER_KEYS = new Set(EXPECTED_MARKERS.map(([key]) => key));

const REQUIRED_CONTRACT_HEADINGS = [
  '## Decision 1 — Live mode must not store conversational plaintext',
  '## Decision 2 — Exact encrypted vs plaintext-open inventory (schema v1 basis)',
  '## Decision 3 — Algorithm and dependency boundary',
  '## Decision 4 — Versioned AEAD envelope',
  '## Decision 5 — Sole runtime key boundary',
  '## Decision 6 — Missing / invalid key ⇒ fail-closed readiness',
  '## Decision 7 — Decrypt / auth failure ⇒ fail-closed',
  '## Decision 8 — Schema v1 plaintext policy (offline compatible / live rejected)',
  '## Decision 9 — Key / version rotation contract (no rotation service yet)',
  '## Decision 10 — Scanner / policy before encrypt; persistence encrypts before SQLite',
  '## Decision 11 — Port-specific treatment (not “all TEXT columns”)',
  '## Decision 12 — Package-private encryption implementation',
  '## Decision 13 — Live gate satisfaction criteria (architecture)',
  '## Decision 14 — Exact implementation map (next encryption implementation commit)',
] as const;

const REQUIRED_CONTRACT_TOKENS = [
  'outbox_entries',
  'plaintext_payload',
  'active_context_json',
  'summary_json',
  'audit_start.metadata_json',
  'AES_256_GCM_NODE_CRYPTO',
  'node:crypto',
  'envelopeVersion',
  'keyId',
  'nonce',
  'ciphertext',
  'tag',
  'neo-communication|',
  'NEO_COMMUNICATION_DATA_KEY_FILE',
  'SILENT_PLAINTEXT_FALLBACK',
  'encryptionLiveGateSatisfied',
  'ENCRYPTION_LIVE_GATE_BLOCKED',
  'create-live-sqlite-communication-ports.ts',
  'communication-aead-envelope.ts',
  'communication-data-key.ts',
  'communication-field-cipher.ts',
  'createOfflineSqliteCommunicationPorts',
  'neo-memory.sqlite',
  'neo-communication.sqlite',
  'PACKAGE_ROOT_EXPORTS',
] as const;

const REQUIRED_ENCRYPTED_FIELDS = [
  'plaintext_payload',
  'active_context_json',
  'summary_json',
] as const;

const REQUIRED_PLAINTEXT_OPEN_TOKENS = [
  'turns',
  'turn_dedup',
  'sequence_counters',
  'factual_history',
  'checkpoint_ops',
  'outbox_outcomes',
  'output_digest',
  'expires_at',
  'fingerprint',
] as const;

function git(args: readonly string[]): string {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function toPosix(pathValue: string): string {
  return pathValue.split(sep).join('/');
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function parseCanonicalMarkers(record: string): Map<string, string> {
  const begin = 'BEGIN_BUILD_3_7G0_MARKERS';
  const end = 'END_BUILD_3_7G0_MARKERS';
  expect(countOccurrences(record, begin)).toBe(1);
  expect(countOccurrences(record, end)).toBe(1);
  const beginIndex = record.indexOf(begin);
  const endIndex = record.indexOf(end);
  expect(beginIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(beginIndex);

  const inside = record.slice(beginIndex + begin.length, endIndex);
  const outside = `${record.slice(0, beginIndex)}\n${record.slice(endIndex + end.length)}`;
  const values = new Map<string, string>();

  for (const rawLine of inside.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const match = /^([A-Z0-9_]+):\s*(.+)$/.exec(line);
    if (!match?.[1] || match[2] === undefined) {
      throw new Error(`unexpected marker line inside block: ${line}`);
    }
    const key = match[1];
    const value = match[2].trim();
    if (!EXPECTED_MARKER_KEYS.has(key)) {
      throw new Error(`unexpected marker key: ${key}`);
    }
    if (values.has(key)) {
      throw new Error(`duplicate marker key: ${key}`);
    }
    values.set(key, value);
  }

  expect(values.size).toBe(EXPECTED_MARKERS.length);
  for (const [key, expectedValue] of EXPECTED_MARKERS) {
    expect(values.get(key)).toBe(expectedValue);
  }

  for (const key of EXPECTED_MARKER_KEYS) {
    const syntax = new RegExp(`(?:^|\\n)\\s*${key}:\\s*\\S`, 'm');
    expect(syntax.test(outside), `known marker syntax outside block for ${key}`).toBe(false);
  }

  return values;
}

function resolveBuildTip(): { tip: string; includeWorkingTree: boolean } {
  const matches = git(['log', `${BUILD_BASE}..HEAD`, '--format=%H%x09%s'])
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const tab = line.indexOf('\t');
      return tab === -1
        ? { hash: line, subject: '' }
        : { hash: line.slice(0, tab), subject: line.slice(tab + 1) };
    })
    .filter((entry) => entry.subject === BUILD_SUBJECT);

  if (matches.length > 1) {
    throw new Error(
      `expected at most one build commit with subject "${BUILD_SUBJECT}", found ${String(matches.length)}`,
    );
  }

  if (matches.length === 1) {
    const only = matches[0];
    if (!only) throw new Error('build commit match missing');
    return { tip: only.hash, includeWorkingTree: false };
  }

  return { tip: git(['rev-parse', 'HEAD']), includeWorkingTree: true };
}

function changedPathsBetween(base: string, tip: string): string[] {
  const output = git(['diff', '--name-only', `${base}...${tip}`]);
  return output.length === 0
    ? []
    : output
        .split('\n')
        .map((line) => toPosix(line.trim()))
        .filter(Boolean);
}

function workingTreePaths(): string[] {
  const paths = new Set<string>();
  const tracked = git(['-c', 'core.quotepath=false', 'diff', '--name-only', 'HEAD']);
  const staged = git(['-c', 'core.quotepath=false', 'diff', '--name-only', '--cached']);
  const untracked = git([
    '-c',
    'core.quotepath=false',
    'ls-files',
    '--others',
    '--exclude-standard',
  ]);
  for (const block of [tracked, staged, untracked]) {
    if (block.length === 0) continue;
    for (const line of block.split('\n')) {
      const pathValue = toPosix(line.trim());
      if (pathValue.length > 0) paths.add(pathValue);
    }
  }
  return [...paths];
}

function gitBlobId(revisionPath: string): string {
  return git(['rev-parse', revisionPath]);
}

function worktreeBlobId(relativePath: string): string {
  return git(['hash-object', `--path=${relativePath}`, relativePath]);
}

function isAllowedPath(pathValue: string): boolean {
  return ALLOWED_EXACT.has(toPosix(pathValue));
}

function isForbiddenPath(pathValue: string): boolean {
  const posix = toPosix(pathValue);
  if ((FORBIDDEN_EXACT as readonly string[]).includes(posix)) return true;
  return FORBIDDEN_PREFIXES.some((prefix) => posix.startsWith(prefix));
}

function readCompanion(relativePath: string): string {
  const absolute = join(REPO_ROOT, relativePath);
  expect(existsSync(absolute), `missing companion: ${relativePath}`).toBe(true);
  return readFileSync(absolute, 'utf8');
}

describe('Build 3.7G0 communication encryption decisions record', () => {
  const record = readFileSync(CLOSEOUT_PATH, 'utf8');
  const tipInfo = resolveBuildTip();

  it('parses exactly one canonical marker block with exact keys and values', () => {
    const markers = parseCanonicalMarkers(record);
    expect(markers.get('BUILD_ID')).toBe('3.7G0');
    expect(markers.get('BUILD_KIND')).toBe('ARCHITECTURE_ONLY');
    expect(markers.get('LIVE_ENCRYPTION')).toBe('ARCHITECTURE_DECIDED');
    expect(markers.get('ENCRYPTION_IMPLEMENTATION')).toBe('ABSENT');
    expect(markers.get('IMPLEMENTATION_READY')).toBe('TRUE');
    expect(markers.get('PRODUCTION_READY')).toBe('FALSE');
  });

  it('freezes fail-closed encryption and key-boundary markers', () => {
    const markers = parseCanonicalMarkers(record);
    expect(markers.get('ENCRYPTION_ALGORITHM')).toBe('AES_256_GCM_NODE_CRYPTO');
    expect(markers.get('KEY_IN_SQLITE')).toBe('FORBIDDEN');
    expect(markers.get('KEY_SOURCE')).toBe('NEO_COMMUNICATION_DATA_KEY_FILE');
    expect(markers.get('SILENT_PLAINTEXT_FALLBACK')).toBe('FORBIDDEN');
    expect(markers.get('SCHEMA_V1_PLAINTEXT_OFFLINE')).toBe('COMPATIBLE');
    expect(markers.get('SCHEMA_V1_PLAINTEXT_LIVE')).toBe('REJECTED');
    expect(markers.get('MEMORY_COMMUNICATION_DB_MERGE')).toBe('FORBIDDEN');
    expect(markers.get('DURABLE_LIVE_INTEGRATION')).toBe(
      'BLOCKED_PENDING_ENCRYPTION_IMPLEMENTATION',
    );
    expect(markers.get('BUILD_3_7F_STATUS')).toBe('BLOCKED');
    expect(markers.get('NEXT_STAGE')).toBe('3.7G_ENCRYPTION_IMPLEMENTATION');
  });

  it('proves IMPLEMENTATION_READY with the exact encryption contract surface', () => {
    for (const heading of REQUIRED_CONTRACT_HEADINGS) {
      expect(record.includes(heading), `missing contract heading: ${heading}`).toBe(true);
    }
    for (const token of REQUIRED_CONTRACT_TOKENS) {
      expect(record.includes(token), `missing contract token: ${token}`).toBe(true);
    }
  });

  it('freezes encrypted conversational fields and plaintext-open machine fields', () => {
    for (const field of REQUIRED_ENCRYPTED_FIELDS) {
      expect(record.includes(field), `missing encrypted field: ${field}`).toBe(true);
    }
    for (const token of REQUIRED_PLAINTEXT_OPEN_TOKENS) {
      expect(record.includes(token), `missing plaintext-open token: ${token}`).toBe(true);
    }
    expect(record).toMatch(/Encrypt-at-rest[\s\S]*?plaintext_payload/);
    expect(record).toMatch(/Plaintext-open[\s\S]*?FIFO/);
    expect(record).toContain('metadata_json');
    expect(record).toMatch(/remain \*\*plaintext-open\*\*/);
  });

  it('freezes AEAD envelope, AAD binding, and scanner-before-encrypt order', () => {
    expect(record).toContain('aes-256-gcm');
    expect(record).toContain('12-byte nonce');
    expect(record).toContain('16-byte authentication tag');
    expect(record).toMatch(/neo-communication\|<schemaVersion>\|<table>/);
    expect(record).toMatch(/sensitive-data scanner \+ product policy/);
    expect(record).toMatch(/AEAD encrypt[\s\S]*?SQLite bind\/sink/);
    expect(record).toMatch(/partial plaintext/);
    expect(record).toMatch(/No new npm cryptography dependency/);
  });

  it('freezes the next implementation file map without claiming code present', () => {
    expect(record).toContain(
      '## Decision 14 — Exact implementation map (next encryption implementation commit)',
    );
    expect(record).toContain('create-live-sqlite-communication-ports.ts');
    expect(record).toContain('communication-field-cipher.ts');
    expect(record).toContain('tests/communication/communication-encryption-live-gate.test.ts');
    expect(record).toMatch(
      /ENCRYPTION_IMPLEMENTATION: ABSENT|Encryption runtime is \*\*absent\*\*/,
    );
    expect(record).toMatch(/does not change production TypeScript behavior/);
    expect(record).not.toMatch(/TELEGRAM_ADAPTER:\s*PRESENT/);
  });

  it('requires the exact architecture package file set', () => {
    const committed = changedPathsBetween(BUILD_BASE, tipInfo.tip);
    const working = tipInfo.includeWorkingTree ? workingTreePaths() : [];
    // Ignore unrelated untracked review patches outside the architecture package.
    const filteredWorking = working.filter(
      (pathValue) =>
        ARCHITECTURE_PACKAGE_FILES.includes(
          pathValue as (typeof ARCHITECTURE_PACKAGE_FILES)[number],
        ) ||
        pathValue.startsWith('docs/') ||
        pathValue.startsWith('tests/build-3.7g0'),
    );
    const all = [...new Set([...committed, ...filteredWorking])].sort();
    const expected = [...ARCHITECTURE_PACKAGE_FILES].sort();
    expect(all).toEqual(expected);
    expect(ARCHITECTURE_PACKAGE_FILES).toHaveLength(6);
    for (const pathValue of all) {
      expect(isAllowedPath(pathValue), `disallowed path: ${pathValue}`).toBe(true);
      expect(isForbiddenPath(pathValue), `forbidden path changed: ${pathValue}`).toBe(false);
    }
  });

  it('reads companion docs for G0 status consistency without production claims', () => {
    expect(COMPANION_DOCS).toHaveLength(4);
    for (const relativePath of COMPANION_DOCS) {
      const text = readCompanion(relativePath);
      expect(text).toMatch(/3\.7G0|encryption at-rest|encryption gate/i);
      expect(text).toMatch(/ARCHITECTURE_ONLY|architecture-only|ARCHITECTURE_DECIDED/i);
      expect(text).toMatch(
        /ENCRYPTION_IMPLEMENTATION:\s*ABSENT|encryption implementation absent|not implemented/i,
      );
      expect(text).toMatch(
        /BLOCKED_PENDING_ENCRYPTION_IMPLEMENTATION|blocked by encryption|BLOCKED_BY_ENCRYPTION/i,
      );
      expect(text).toMatch(/PRODUCTION_READY:\s*FALSE/);
      expect(text).not.toMatch(/PRODUCTION_READY:\s*TRUE/);
      expect(text).not.toMatch(/\bproduction ready\b/i);
    }
  });

  it('keeps historical closeout content hashes equal to Build base', () => {
    for (const relativePath of HISTORICAL_CLOSEOUTS) {
      const baseBlob = gitBlobId(`${BUILD_BASE}:${relativePath}`);
      const tipBlob = gitBlobId(`${tipInfo.tip}:${relativePath}`);
      expect(tipBlob).toBe(baseBlob);
      if (tipInfo.includeWorkingTree) {
        expect(existsSync(join(REPO_ROOT, relativePath))).toBe(true);
        expect(worktreeBlobId(relativePath)).toBe(baseBlob);
      }
    }
  });

  it('does not change src, package manifests, security-policy, or deployment', () => {
    const committed = changedPathsBetween(BUILD_BASE, tipInfo.tip);
    const working = tipInfo.includeWorkingTree ? workingTreePaths() : [];
    const all = [...new Set([...committed, ...working])].filter((pathValue) =>
      ARCHITECTURE_PACKAGE_FILES.includes(pathValue as (typeof ARCHITECTURE_PACKAGE_FILES)[number]),
    );
    for (const pathValue of all) {
      expect(pathValue.startsWith('src/'), `src changed: ${pathValue}`).toBe(false);
      expect(pathValue === 'package.json' || pathValue === 'package-lock.json').toBe(false);
      expect(pathValue === '.env.example').toBe(false);
      expect(pathValue === 'docs/security-policy.md' || pathValue === 'docs/deployment.md').toBe(
        false,
      );
    }
  });
});
