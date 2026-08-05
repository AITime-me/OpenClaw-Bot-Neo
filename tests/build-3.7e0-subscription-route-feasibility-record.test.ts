import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const BUILD_BASE = '35567435ebf018af63c70f58672e5dc2ca98086c';
const CLOSEOUT_SUBJECT = 'docs(llm): close Build 3.7E0 subscription route feasibility';

const CLOSEOUT_REL = 'docs/validation/build-3.7e0-subscription-route-feasibility.md';
const LLM_REL = 'docs/llm-provider.md';
const ARCH_REL = 'docs/communication/text-architecture.md';
const MAP_REL = 'docs/communication/text-implementation-map.md';
const COMPAT_REL = 'docs/openclaw-compatibility.md';
const DEPLOY_REL = 'docs/deployment.md';
const SECURITY_REL = 'docs/security-policy.md';
const ACCEPT_REL = 'docs/acceptance-criteria.md';
const README_REL = 'README.md';
const TEST_REL = 'tests/build-3.7e0-subscription-route-feasibility-record.test.ts';

const CLOSEOUT_PATH = join(REPO_ROOT, CLOSEOUT_REL);

const HISTORICAL_CLOSEOUTS = [
  'docs/validation/build-3.5b-connector-platform-core-closeout.md',
  'docs/validation/build-3.6b-infrastructure-fleet-foundation-closeout.md',
  'docs/validation/build-3.7a-text-communication-design-closeout.md',
  'docs/validation/codex-review-6-r6-h01-readiness-race-closeout.md',
  'docs/validation/codex-review-6-r6-h02-durable-memory-secret-boundary-closeout.md',
  'docs/validation/codex-review-6-r6-m01-retryable-durable-owner-closeout.md',
  'docs/validation/codex-review-6-r6-m02-production-node-gate-systemd-closeout.md',
  'docs/validation/codex-review-6-r6-m03-live-process-identity-closeout.md',
  'docs/validation/codex-review-6-r6-low-hardening-package-closeout.md',
] as const;

const ALLOWED_EXACT = new Set([
  README_REL,
  LLM_REL,
  COMPAT_REL,
  DEPLOY_REL,
  SECURITY_REL,
  ACCEPT_REL,
  MAP_REL,
  ARCH_REL,
  CLOSEOUT_REL,
  TEST_REL,
]);

const FORBIDDEN_EXACT = ['package.json', 'package-lock.json', 'src/index.ts'] as const;

const MARKERS: ReadonlyArray<readonly [string, string]> = [
  ['BUILD_ID', '3.7E0'],
  ['BUILD_KIND', 'RESEARCH_ONLY'],
  ['IMPLEMENTATION_STATUS', 'ABSENT'],
  ['RESEARCH_EXECUTIVE_VERDICT', 'FAIL_UNDER_ABSOLUTE_ZERO_PAID_FALLBACK_CRITERION'],
  ['TECHNICAL_SUBSCRIPTION_ROUTE', 'PASS'],
  ['LIVE_OPERATIONAL_APPROVAL', 'UNRESOLVED'],
  ['PROVIDER_STRATEGY', 'RETAIN_CHATGPT_CODEX_AS_PRIMARY_CANDIDATE'],
  ['CHATGPT_AUTH_MODE', 'VERIFIED'],
  ['MANUAL_API_KEY_REQUIRED', 'FALSE'],
  ['OPENAI_PLATFORM_API_ALLOWED', 'FALSE'],
  ['API_KEY_FALLBACK_ALLOWED', 'FALSE'],
  ['TOKEN_BILLED_API_ALLOWED', 'FALSE'],
  ['EXISTING_CHATGPT_CREDITS_CAN_BE_CONSUMED', 'TRUE'],
  ['ZERO_ADDITIONAL_SPEND_GUARANTEE', 'ACCOUNT_PREREQUISITES_REQUIRED'],
  ['CAPABILITY_PROBE_STATUS', 'NOT_RUN'],
  ['BUILD_3_7B_D_STATUS', 'OFFLINE_ONLY_ALLOWED'],
  ['BUILD_3_7E1_STATUS', 'BLOCKED'],
  ['BUILD_3_7F_STATUS', 'BLOCKED'],
  ['NEXT_STAGE', '3.7B'],
  ['PRODUCTION_READY', 'FALSE'],
  ['SECURITY_APPROVED', 'FALSE'],
];

function git(args: readonly string[]): string {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function normalizeWs(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseMarkers(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const match = /^([A-Z0-9_]+):\s*(.+)\s*$/.exec(line.trim());
    if (match?.[1] && match[2]) map.set(match[1], match[2]);
  }
  return map;
}

function toPosix(pathValue: string): string {
  return pathValue.split(sep).join('/');
}

function isAllowedPath(pathValue: string): boolean {
  return ALLOWED_EXACT.has(toPosix(pathValue));
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
    .filter((entry) => entry.subject === CLOSEOUT_SUBJECT);

  if (matches.length > 0) {
    const first = matches[0];
    if (!first) return { tip: git(['rev-parse', 'HEAD']), includeWorkingTree: true };
    return { tip: first.hash, includeWorkingTree: false };
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

function containsNormalized(haystack: string, needle: string): boolean {
  return normalizeWs(haystack).includes(normalizeWs(needle));
}

describe('Build 3.7E0 subscription route feasibility record', () => {
  const record = readFileSync(CLOSEOUT_PATH, 'utf8');
  const llmProvider = readFileSync(join(REPO_ROOT, LLM_REL), 'utf8');
  const architecture = readFileSync(join(REPO_ROOT, ARCH_REL), 'utf8');
  const implementationMap = readFileSync(join(REPO_ROOT, MAP_REL), 'utf8');
  const compatibility = readFileSync(join(REPO_ROOT, COMPAT_REL), 'utf8');
  const deployment = readFileSync(join(REPO_ROOT, DEPLOY_REL), 'utf8');
  const security = readFileSync(join(REPO_ROOT, SECURITY_REL), 'utf8');
  const acceptance = readFileSync(join(REPO_ROOT, ACCEPT_REL), 'utf8');
  const readme = readFileSync(join(REPO_ROOT, README_REL), 'utf8');
  const tipInfo = resolveBuildTip();
  const markers = parseMarkers(record);

  it('exposes all machine-readable markers', () => {
    for (const [key, value] of MARKERS) {
      expect(markers.get(key)).toBe(value);
    }
  });

  it('does not claim production, live, or security approval', () => {
    expect(markers.get('PRODUCTION_READY')).toBe('FALSE');
    expect(markers.get('SECURITY_APPROVED')).toBe('FALSE');
    expect(markers.get('LIVE_OPERATIONAL_APPROVAL')).toBe('UNRESOLVED');
    expect(markers.get('IMPLEMENTATION_STATUS')).toBe('ABSENT');
    expect(record).not.toMatch(/PRODUCTION_READY:\s*TRUE/);
    expect(record).not.toMatch(/SECURITY_APPROVED:\s*TRUE/);
    expect(record).not.toMatch(/is production[- ]ready/i);
    expect(record).not.toMatch(/security approval (was|is) complete/i);
    expect(record).not.toMatch(/LIVE_OPERATIONAL_APPROVAL:\s*PASS/);
  });

  it('records technical PASS and live UNRESOLVED without rewriting research FAIL', () => {
    expect(markers.get('TECHNICAL_SUBSCRIPTION_ROUTE')).toBe('PASS');
    expect(markers.get('LIVE_OPERATIONAL_APPROVAL')).toBe('UNRESOLVED');
    expect(markers.get('RESEARCH_EXECUTIVE_VERDICT')).toBe(
      'FAIL_UNDER_ABSOLUTE_ZERO_PAID_FALLBACK_CRITERION',
    );
    expect(containsNormalized(record, 'does **not** call that verdict an error')).toBe(true);
  });

  it('separates ChatGPT auth from API-key auth and forbids Platform API', () => {
    expect(markers.get('CHATGPT_AUTH_MODE')).toBe('VERIFIED');
    expect(markers.get('MANUAL_API_KEY_REQUIRED')).toBe('FALSE');
    expect(markers.get('OPENAI_PLATFORM_API_ALLOWED')).toBe('FALSE');
    expect(markers.get('API_KEY_FALLBACK_ALLOWED')).toBe('FALSE');
    expect(markers.get('TOKEN_BILLED_API_ALLOWED')).toBe('FALSE');
    expect(
      containsNormalized(record, 'auth_mode = chatgpt') ||
        containsNormalized(record, 'auth_mode=chatgpt'),
    ).toBe(true);
  });

  it('records existing ChatGPT credits can be consumed without repository zero-spend guarantee', () => {
    expect(markers.get('EXISTING_CHATGPT_CREDITS_CAN_BE_CONSUMED')).toBe('TRUE');
    expect(markers.get('ZERO_ADDITIONAL_SPEND_GUARANTEE')).toBe('ACCOUNT_PREREQUISITES_REQUIRED');
    expect(containsNormalized(record, 'ACCOUNT_PREREQUISITES_REQUIRED')).toBe(true);
  });

  it('keeps capability probe NOT_RUN and next stage 3.7B', () => {
    expect(markers.get('CAPABILITY_PROBE_STATUS')).toBe('NOT_RUN');
    expect(markers.get('NEXT_STAGE')).toBe('3.7B');
    expect(containsNormalized(record, 'NEXT_STAGE: 3.7B')).toBe(true);
  });

  it('allows offline 3.7B–D and blocks 3.7E1 and 3.7F', () => {
    expect(markers.get('BUILD_3_7B_D_STATUS')).toBe('OFFLINE_ONLY_ALLOWED');
    expect(markers.get('BUILD_3_7E1_STATUS')).toBe('BLOCKED');
    expect(markers.get('BUILD_3_7F_STATUS')).toBe('BLOCKED');
    expect(containsNormalized(record, 'fake completion')).toBe(true);
    expect(containsNormalized(implementationMap, 'BLOCKED')).toBe(true);
  });

  it('retains ChatGPT/Codex as primary provider strategy', () => {
    expect(markers.get('PROVIDER_STRATEGY')).toBe('RETAIN_CHATGPT_CODEX_AS_PRIMARY_CANDIDATE');
    expect(containsNormalized(record, 'RETAIN_CHATGPT_CODEX_AS_PRIMARY_CANDIDATE')).toBe(true);
    expect(containsNormalized(llmProvider, 'RETAIN_CHATGPT_CODEX_AS_PRIMARY_CANDIDATE')).toBe(true);
  });

  it('limits Build 3.7E0 changed paths to the documentation allowlist', () => {
    const committed = changedPathsBetween(BUILD_BASE, tipInfo.tip);
    const working = tipInfo.includeWorkingTree ? workingTreePaths() : [];
    const all = [...new Set([...committed, ...working])];
    expect(all.length).toBeGreaterThan(0);
    for (const pathValue of all) {
      expect(isAllowedPath(pathValue), `disallowed path: ${pathValue}`).toBe(true);
    }
    for (const forbidden of FORBIDDEN_EXACT) {
      expect(all.includes(forbidden)).toBe(false);
    }
    expect(all.some((pathValue) => pathValue.startsWith('src/'))).toBe(false);
    expect(all.some((pathValue) => pathValue.includes('neo-runtime-diagnostics'))).toBe(false);
    expect(all.some((pathValue) => pathValue.includes('/adapters/'))).toBe(false);
  });

  it('keeps historical closeout blobs equal to Build base', () => {
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

  it('keeps current docs consistent on technical PASS, live UNRESOLVED, E1/F BLOCKED, next 3.7B', () => {
    const docs = [
      record,
      llmProvider,
      architecture,
      implementationMap,
      compatibility,
      deployment,
      security,
      acceptance,
      readme,
    ];
    for (const doc of docs) {
      expect(containsNormalized(doc, 'PASS')).toBe(true);
      expect(containsNormalized(doc, 'UNRESOLVED')).toBe(true);
    }
    expect(containsNormalized(llmProvider, 'TECHNICAL_SUBSCRIPTION_ROUTE')).toBe(true);
    expect(containsNormalized(architecture, 'TECHNICAL_SUBSCRIPTION_ROUTE: PASS')).toBe(true);
    expect(containsNormalized(architecture, 'LIVE_OPERATIONAL_APPROVAL: UNRESOLVED')).toBe(true);
    expect(
      containsNormalized(implementationMap, 'next stage 3.7B') ||
        containsNormalized(implementationMap, 'next stage: **3.7B**') ||
        containsNormalized(implementationMap, '**Build 3.7B**'),
    ).toBe(true);
    expect(
      containsNormalized(implementationMap, '3.7E1') &&
        containsNormalized(implementationMap, 'BLOCKED'),
    ).toBe(true);
    expect(containsNormalized(readme, '3.7E0')).toBe(true);
    expect(
      containsNormalized(acceptance, '3.7E1/3.7F blocked') ||
        containsNormalized(acceptance, '3.7E1/3.7F blocked'),
    ).toBe(true);
  });
});
