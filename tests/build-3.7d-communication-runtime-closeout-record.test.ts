import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const BUILD_BASE = 'f854e9777431eb78cdd7d4e1d44e42cb90815df4';
const BUILD_SUBJECT = 'feat(communication): add Build 3.7D offline runtime';

const CLOSEOUT_REL = 'docs/validation/build-3.7d-communication-runtime-closeout.md';
const CLOSEOUT_PATH = join(REPO_ROOT, CLOSEOUT_REL);
const TEST_REL = 'tests/build-3.7d-communication-runtime-closeout-record.test.ts';

const HISTORICAL_CLOSEOUTS = [
  'docs/validation/build-3.7a-text-communication-design-closeout.md',
  'docs/validation/build-3.7b-communication-contracts-closeout.md',
  'docs/validation/build-3.7c0-communication-persistence-decisions.md',
  'docs/validation/build-3.7c-communication-persistence-closeout.md',
  'docs/validation/build-3.7e0-subscription-route-feasibility.md',
] as const;

const ALLOWED_PREFIXES = [
  'src/core/communication/domain/',
  'src/core/communication/ports/',
  'src/core/communication/policy/',
  'src/core/communication/application/',
  'src/communication/reference/',
  'src/host/storage/sqlite/communication/',
  'tests/communication/',
  'tests/fixtures/boundaries/forbidden-communication-application-imports-',
  'tests/fixtures/boundaries/forbidden-communication-reference-imports-',
  'scripts/',
  'docs/communication/',
  'docs/validation/',
] as const;

const ALLOWED_EXACT = new Set([
  CLOSEOUT_REL,
  TEST_REL,
  'docs/validation/build-3.7d0-communication-runtime-decisions.md',
  'tests/build-3.7d0-communication-runtime-decisions-record.test.ts',
  'tests/communication/communication-runtime.test.ts',
  'tests/communication/communication-boundaries.test.ts',
  'tests/communication/communication-public-api-isolation.test.ts',
  'tests/host-sqlite-communication-ports.test.ts',
  'tests/boundaries.test.ts',
  'package.json',
  '.dependency-cruiser.cjs',
  'docs/architecture.md',
  'docs/security-policy.md',
  'docs/acceptance-criteria.md',
]);

const FORBIDDEN_EXACT = ['package-lock.json', 'src/index.ts', 'src/host/index.ts'] as const;

const FORBIDDEN_PREFIXES = ['src/communication/adapters/', 'src/neo-runtime/production/'] as const;

const EXPECTED_MARKERS: ReadonlyArray<readonly [string, string]> = [
  ['BUILD_ID', '3.7D'],
  ['BUILD_KIND', 'OFFLINE_EXECUTABLE_RUNTIME'],
  ['IMPLEMENTATION_STATUS', 'IMPLEMENTED'],
  ['BUILD_3_7C_MODE', 'OFFLINE_ONLY'],
  ['DURABLE_SQLITE_IMPLEMENTATION', 'PRESENT'],
  ['LIVE_ENCRYPTION', 'NOT_IMPLEMENTED'],
  ['EXECUTABLE_COMMUNICATION_RUNTIME', 'PRESENT'],
  ['FAIL_SAFE_NO_RESUME_RECOVERY', 'TRUE'],
  ['SQLITE_SCHEMA_VERSION', '1'],
  ['FAKE_COMPLETION_ONLY', 'TRUE'],
  ['PRODUCTION_COMPOSITION', 'ABSENT'],
  ['PACKAGE_ROOT_EXPORTS', 'ABSENT'],
  ['BUILD_3_7E1_STATUS', 'BLOCKED'],
  ['BUILD_3_7F_STATUS', 'BLOCKED'],
  ['PRODUCTION_READY', 'FALSE'],
  ['SECURITY_APPROVED', 'FALSE'],
  ['NEXT_STAGE', '3.7E1'],
];

const EXPECTED_MARKER_KEYS = new Set(EXPECTED_MARKERS.map(([key]) => key));

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
  const begin = 'BEGIN_BUILD_3_7D_MARKERS';
  const end = 'END_BUILD_3_7D_MARKERS';
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
  const output = git(['-c', 'core.quotepath=false', 'status', '--porcelain', '-uall']);
  if (output.length === 0) return [];
  const paths = new Set<string>();
  for (const rawLine of output.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.trim().length === 0) continue;
    const match = /^(?:[ MADRCU?]{2}|!!) (?:.+? -> )?(.+)$/.exec(line);
    if (!match?.[1]) continue;
    let pathValue = match[1].trim();
    if (
      (pathValue.startsWith('"') && pathValue.endsWith('"')) ||
      (pathValue.startsWith("'") && pathValue.endsWith("'"))
    ) {
      pathValue = pathValue.slice(1, -1);
    }
    paths.add(toPosix(pathValue));
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
  const posix = toPosix(pathValue);
  if (ALLOWED_EXACT.has(posix)) return true;
  return ALLOWED_PREFIXES.some((prefix) => posix.startsWith(prefix));
}

function isForbiddenPath(pathValue: string): boolean {
  const posix = toPosix(pathValue);
  if ((FORBIDDEN_EXACT as readonly string[]).includes(posix)) return true;
  return FORBIDDEN_PREFIXES.some((prefix) => posix.startsWith(prefix));
}

describe('Build 3.7D communication runtime closeout record', () => {
  const record = readFileSync(CLOSEOUT_PATH, 'utf8');
  const tipInfo = resolveBuildTip();

  it('parses exactly one canonical marker block with exact keys and values', () => {
    const markers = parseCanonicalMarkers(record);
    expect(markers.get('BUILD_KIND')).toBe('OFFLINE_EXECUTABLE_RUNTIME');
    expect(markers.get('EXECUTABLE_COMMUNICATION_RUNTIME')).toBe('PRESENT');
    expect(markers.get('FAIL_SAFE_NO_RESUME_RECOVERY')).toBe('TRUE');
    expect(markers.get('SQLITE_SCHEMA_VERSION')).toBe('1');
    expect(markers.get('FAKE_COMPLETION_ONLY')).toBe('TRUE');
  });

  it('keeps E1/F blocked and does not claim production readiness', () => {
    const markers = parseCanonicalMarkers(record);
    expect(markers.get('BUILD_3_7E1_STATUS')).toBe('BLOCKED');
    expect(markers.get('BUILD_3_7F_STATUS')).toBe('BLOCKED');
    expect(markers.get('PRODUCTION_READY')).toBe('FALSE');
    expect(markers.get('SECURITY_APPROVED')).toBe('FALSE');
    expect(markers.get('LIVE_ENCRYPTION')).toBe('NOT_IMPLEMENTED');
    expect(markers.get('PRODUCTION_COMPOSITION')).toBe('ABSENT');
  });

  it('limits Build 3.7D changed paths and requires application/reference runtime trees', () => {
    const committed = changedPathsBetween(BUILD_BASE, tipInfo.tip);
    const working = tipInfo.includeWorkingTree ? workingTreePaths() : [];
    const all = [...new Set([...committed, ...working])];
    expect(all.length).toBeGreaterThan(0);
    for (const pathValue of all) {
      expect(isAllowedPath(pathValue), `disallowed path: ${pathValue}`).toBe(true);
      expect(isForbiddenPath(pathValue), `forbidden path changed: ${pathValue}`).toBe(false);
    }
    expect(
      existsSync(
        join(REPO_ROOT, 'src/core/communication/application/communication-orchestrator.ts'),
      ),
    ).toBe(true);
    expect(
      existsSync(join(REPO_ROOT, 'src/communication/reference/create-reference-text-slice.ts')),
    ).toBe(true);
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
});
