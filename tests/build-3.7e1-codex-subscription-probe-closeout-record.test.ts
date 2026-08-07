import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const BUILD_BASE = 'da0677997aad4cd1ab2cd54000c9961a8130b637';
const BUILD_SUBJECT = 'feat(communication): add probe-only Codex subscription route';
const CLOSEOUT_REL = 'docs/validation/build-3.7e1-codex-subscription-probe-closeout.md';
const CLOSEOUT_PATH = join(REPO_ROOT, CLOSEOUT_REL);

const EXPECTED_MARKERS: ReadonlyArray<readonly [string, string]> = [
  ['BUILD_ID', '3.7E1'],
  ['BUILD_KIND', 'PROBE_ONLY_IMPLEMENTATION'],
  ['IMPLEMENTATION_STATUS', 'IMPLEMENTED'],
  ['ROUTE_SCOPE', 'PROBE_ONLY'],
  ['ADAPTER', 'CODEX_APP_SERVER_STDIO'],
  ['NEO_READS_CREDENTIALS', 'FALSE'],
  ['LIVE_PROBE_STATUS', 'EXECUTED_FAIL'],
  ['LIVE_PROBE_OUTCOME', 'provider-unavailable'],
  ['LIVE_PROBE_FAILURE_STAGE', 'PRE_DISPATCH_COMPATIBILITY'],
  ['LIVE_PROBE_CODEX_CLI', '0.147.0'],
  ['LIVE_PROBE', 'OWNER_APPROVAL_REQUIRED'],
  ['DURABLE_3_7D_INTEGRATION', 'BLOCKED_BY_ENCRYPTION'],
  ['OPENCLAW_ROUTE', 'OUT_OF_SCOPE'],
  ['PRODUCTION_READY', 'FALSE'],
  ['PACKAGE_ROOT_EXPORTS', 'ABSENT'],
];

const REQUIRED_PATHS = [
  'src/communication/adapters/codex-app-server/create-codex-app-server-route.ts',
  'src/communication/adapters/codex-app-server/fake/fake-codex-app-server.ts',
  'scripts/manual/codex-app-server-owner-probe.mjs',
  CLOSEOUT_REL,
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

describe('Build 3.7E1 Codex subscription probe closeout record', () => {
  const record = readFileSync(CLOSEOUT_PATH, 'utf8');

  it('parses markers including LIVE_PROBE_STATUS EXECUTED_FAIL', () => {
    const normalized = record.replace(/\r\n/g, '\n');
    for (const [key, value] of EXPECTED_MARKERS) {
      expect(normalized).toMatch(
        new RegExp(`(?:^|\\n)${key}:\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\n|$)`),
      );
    }
    expect(normalized).toContain('LIVE_PROBE_STATUS: EXECUTED_FAIL');
    expect(normalized).not.toContain('LIVE_PROBE_STATUS: NOT_RUN');
    expect(normalized).not.toMatch(/LIVE_PROBE_STATUS:\s*EXECUTED_PASS/);
  });

  it('keeps required adapter/fake/manual/evidence paths present', () => {
    for (const relative of REQUIRED_PATHS) {
      expect(existsSync(join(REPO_ROOT, relative)), relative).toBe(true);
    }
  });

  it('does not claim production readiness or OpenClaw verification', () => {
    expect(record).toContain('PRODUCTION_READY: FALSE');
    expect(record).toContain('OPENCLAW_ROUTE: OUT_OF_SCOPE');
    expect(record).not.toMatch(/\bproduction ready\b/i);
  });

  it('scopes implementation changes away from package-lock and root exports', () => {
    const tip = git(['rev-parse', 'HEAD']);
    const working = git(['-c', 'core.quotepath=false', 'status', '--porcelain', '-uall']);
    const committed = git(['diff', '--name-only', `${BUILD_BASE}...${tip}`])
      .split('\n')
      .map((line) => toPosix(line.trim()))
      .filter(Boolean);
    const all = new Set(committed);
    if (working.length > 0) {
      for (const raw of working.split('\n')) {
        const match = /^(?:[ MADRCU?]{2}|!!) (?:.+? -> )?(.+)$/.exec(raw.replace(/\r$/, ''));
        if (match?.[1]) all.add(toPosix(match[1].trim()));
      }
    }
    expect(all.has('package-lock.json')).toBe(false);
    expect(all.has('src/index.ts')).toBe(false);
    expect(
      [...all].some((path) => path.startsWith('src/communication/adapters/codex-app-server/')),
    ).toBe(true);
    void BUILD_SUBJECT;
  });
});
