import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const BUILD_BASE = 'b443d7b8e6afc7d2ba5860e53f86f390a0f07f16';
const BUILD_SUBJECT = 'docs(communication): decide Build 3.7E1A Codex probe route';

const CLOSEOUT_REL = 'docs/validation/build-3.7e1a-codex-subscription-probe-decisions.md';
const CLOSEOUT_PATH = join(REPO_ROOT, CLOSEOUT_REL);
const TEST_REL = 'tests/build-3.7e1a-codex-subscription-probe-decisions-record.test.ts';

const HISTORICAL_CLOSEOUTS = [
  'docs/validation/build-3.7a-text-communication-design-closeout.md',
  'docs/validation/build-3.7b-communication-contracts-closeout.md',
  'docs/validation/build-3.7c0-communication-persistence-decisions.md',
  'docs/validation/build-3.7c-communication-persistence-closeout.md',
  'docs/validation/build-3.7d0-communication-runtime-decisions.md',
  'docs/validation/build-3.7d-communication-runtime-closeout.md',
  'docs/validation/build-3.7e0-subscription-route-feasibility.md',
] as const;

const ALLOWED_EXACT = new Set([
  CLOSEOUT_REL,
  TEST_REL,
  'docs/communication/text-implementation-map.md',
  'docs/communication/text-architecture.md',
  'docs/llm-provider.md',
  'docs/openclaw-compatibility.md',
  'docs/acceptance-criteria.md',
]);

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
  ['BUILD_ID', '3.7E1A'],
  ['BUILD_KIND', 'ARCHITECTURE_ONLY'],
  ['ROUTE_SCOPE', 'PROBE_ONLY'],
  ['ADAPTER', 'CODEX_APP_SERVER_STDIO'],
  ['AUTH_BOUNDARY', 'CODEX_MANAGED_CHATGPT_OAUTH'],
  ['NEO_READS_CREDENTIALS', 'FALSE'],
  ['CODEX_HOME', 'ISOLATED_REQUIRED'],
  ['API_FALLBACK_ENABLED', 'FALSE'],
  ['PAID_FALLBACK_ENABLED', 'FALSE'],
  ['LIVE_PROBE', 'OWNER_APPROVAL_REQUIRED'],
  ['NEO_SQLITE_PERSISTENCE', 'FORBIDDEN'],
  ['DURABLE_3_7D_INTEGRATION', 'BLOCKED_BY_ENCRYPTION'],
  ['OPENCLAW_ROUTE', 'OUT_OF_SCOPE'],
  ['PRODUCTION_READY', 'FALSE'],
  ['IMPLEMENTATION_READY', 'TRUE'],
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
  const begin = 'BEGIN_BUILD_3_7E1A_MARKERS';
  const end = 'END_BUILD_3_7E1A_MARKERS';
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
  return ALLOWED_EXACT.has(toPosix(pathValue));
}

function isForbiddenPath(pathValue: string): boolean {
  const posix = toPosix(pathValue);
  if ((FORBIDDEN_EXACT as readonly string[]).includes(posix)) return true;
  return FORBIDDEN_PREFIXES.some((prefix) => posix.startsWith(prefix));
}

describe('Build 3.7E1A Codex subscription probe decisions record', () => {
  const record = readFileSync(CLOSEOUT_PATH, 'utf8');
  const tipInfo = resolveBuildTip();

  it('parses exactly one canonical marker block with exact keys and values', () => {
    const markers = parseCanonicalMarkers(record);
    expect(markers.get('BUILD_ID')).toBe('3.7E1A');
    expect(markers.get('BUILD_KIND')).toBe('ARCHITECTURE_ONLY');
    expect(markers.get('ADAPTER')).toBe('CODEX_APP_SERVER_STDIO');
    expect(markers.get('AUTH_BOUNDARY')).toBe('CODEX_MANAGED_CHATGPT_OAUTH');
    expect(markers.get('NEO_READS_CREDENTIALS')).toBe('FALSE');
    expect(markers.get('IMPLEMENTATION_READY')).toBe('TRUE');
    expect(markers.get('PRODUCTION_READY')).toBe('FALSE');
  });

  it('keeps probe-only boundaries and blocks durable/OpenClaw production claims', () => {
    const markers = parseCanonicalMarkers(record);
    expect(markers.get('ROUTE_SCOPE')).toBe('PROBE_ONLY');
    expect(markers.get('CODEX_HOME')).toBe('ISOLATED_REQUIRED');
    expect(markers.get('API_FALLBACK_ENABLED')).toBe('FALSE');
    expect(markers.get('PAID_FALLBACK_ENABLED')).toBe('FALSE');
    expect(markers.get('LIVE_PROBE')).toBe('OWNER_APPROVAL_REQUIRED');
    expect(markers.get('NEO_SQLITE_PERSISTENCE')).toBe('FORBIDDEN');
    expect(markers.get('DURABLE_3_7D_INTEGRATION')).toBe('BLOCKED_BY_ENCRYPTION');
    expect(markers.get('OPENCLAW_ROUTE')).toBe('OUT_OF_SCOPE');
  });

  it('limits Build 3.7E1A changed paths to the architecture-only allowlist', () => {
    const committed = changedPathsBetween(BUILD_BASE, tipInfo.tip);
    const working = tipInfo.includeWorkingTree ? workingTreePaths() : [];
    const all = [...new Set([...committed, ...working])];
    expect(all.length).toBeGreaterThan(0);
    for (const pathValue of all) {
      expect(isAllowedPath(pathValue), `disallowed path: ${pathValue}`).toBe(true);
      expect(isForbiddenPath(pathValue), `forbidden path changed: ${pathValue}`).toBe(false);
    }
    expect(existsSync(CLOSEOUT_PATH)).toBe(true);
    expect(record.includes('codex-openclaw')).toBe(false);
    expect(record).toMatch(/Codex app-server/);
    expect(record).toMatch(/OpenClaw/);
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
    const all = [...new Set([...committed, ...working])];
    for (const pathValue of all) {
      expect(pathValue.startsWith('src/'), `src changed: ${pathValue}`).toBe(false);
      expect(pathValue === 'package.json' || pathValue === 'package-lock.json').toBe(false);
      expect(pathValue === 'docs/security-policy.md' || pathValue === 'docs/deployment.md').toBe(
        false,
      );
    }
  });
});
