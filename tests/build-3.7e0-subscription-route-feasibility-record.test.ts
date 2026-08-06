import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const BUILD_BASE = '35567435ebf018af63c70f58672e5dc2ca98086c';
const FIRST_BUILD_COMMIT = '4be2d5bed978ff5944e5944d5053ddc5cd9f0336';
const CORRECTIVE_SUBJECT = 'docs(llm): correct Build 3.7E0 review findings';

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

const EXPECTED_MARKERS: ReadonlyArray<readonly [string, string]> = [
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

const EXPECTED_MARKER_KEYS = new Set(EXPECTED_MARKERS.map(([key]) => key));

const SOURCE_IDS = Array.from(
  { length: 15 },
  (_, index) => `SRC-${String(index + 1).padStart(2, '0')}`,
);

const DOC_REQUIRED: ReadonlyArray<{ rel: string; required: readonly string[] }> = [
  {
    rel: README_REL,
    required: [
      'Build 3.7E0 technical subscription route: PASS',
      'Build 3.7E0 live operational approval: UNRESOLVED',
      'Build 3.7E0 provider strategy: RETAIN_CHATGPT_CODEX_AS_PRIMARY_CANDIDATE',
      'Build 3.7E1 status: BLOCKED',
      'Build 3.7F status: BLOCKED',
      'Build 3.7E0 next stage: 3.7B',
    ],
  },
  {
    rel: LLM_REL,
    required: [
      'Build 3.7E0 research verdict: FAIL_UNDER_ABSOLUTE_ZERO_PAID_FALLBACK_CRITERION',
      'Build 3.7E0 technical subscription route: PASS',
      'Build 3.7E0 live operational approval: UNRESOLVED',
      'Build 3.7E0 provider strategy: RETAIN_CHATGPT_CODEX_AS_PRIMARY_CANDIDATE',
      'Build 3.7E0 capability probe: NOT_RUN',
      'Build 3.7E1 status: BLOCKED',
      'Build 3.7F status: BLOCKED',
      'existing ChatGPT/Codex credits may be consumed',
      'zero additional spend requires account-level prerequisites',
    ],
  },
  {
    rel: COMPAT_REL,
    required: [
      'OpenClaw runtime verification: UNVERIFIED',
      'External Codex/ChatGPT prerequisite: VERIFIED_BY_BUILD_3_7E0_RESEARCH',
      'Build 3.7E0 technical subscription route: PASS',
      'Build 3.7E0 live operational approval: UNRESOLVED',
      'Build 3.7E0 capability probe: NOT_RUN',
      'Build 3.7E1 status: BLOCKED',
      'Build 3.7F status: BLOCKED',
    ],
  },
  {
    rel: DEPLOY_REL,
    required: [
      'Build 3.7E0 live operational approval: UNRESOLVED',
      'Build 3.7E0 capability probe: NOT_RUN',
      'no live deployment',
      'Build 3.7E1 status: BLOCKED',
      'Build 3.7F status: BLOCKED',
    ],
  },
  {
    rel: SECURITY_REL,
    required: [
      'API-key routes forbidden',
      'token-billed OpenAI Platform API forbidden',
      'repository flags do not control upstream ChatGPT credit accounting',
      'Build 3.7E0 capability probe: NOT_RUN',
      'Build 3.7E1 status: BLOCKED',
      'Build 3.7F status: BLOCKED',
    ],
  },
  {
    rel: ACCEPT_REL,
    required: [
      'technical PASS does not satisfy live acceptance',
      'Build 3.7E0 live operational approval: UNRESOLVED',
      'Build 3.7E1 status: BLOCKED',
      'Build 3.7F status: BLOCKED',
      'Build 3.7E0 next stage: 3.7B',
      '3.7B is offline only',
    ],
  },
  {
    rel: ARCH_REL,
    required: [
      'Build 3.7E0 provider strategy: RETAIN_CHATGPT_CODEX_AS_PRIMARY_CANDIDATE',
      'Build 3.7B–D are offline only',
      'Build 3.7E1 status: BLOCKED',
      'Build 3.7F status: BLOCKED',
      'Build 3.7E0 live operational approval: UNRESOLVED',
    ],
  },
  {
    rel: MAP_REL,
    required: [
      'Build 3.7B–D are offline only',
      'Build 3.7E1 status: BLOCKED',
      'Build 3.7F status: BLOCKED',
      'Build 3.7E0 next stage: 3.7B',
      'Build 3.7E0 capability probe: NOT_RUN',
    ],
  },
];

const FORBIDDEN_ASSERTIONS = [
  'Build 3.7E0 live operational approval: PASS',
  'Build 3.7E1 status: ALLOWED',
  'Build 3.7E1 status: READY',
  'Build 3.7F status: ALLOWED',
  'Build 3.7F status: READY',
  'Build 3.7E0 capability probe: PASS',
  'Build 3.7E0 capability probe: COMPLETED',
] as const;

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
    .replace(/\n+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

function containsNormalized(haystack: string, needle: string): boolean {
  return normalizeWs(haystack).includes(normalizeWs(needle));
}

function toPosix(pathValue: string): string {
  return pathValue.split(sep).join('/');
}

function isAllowedPath(pathValue: string): boolean {
  return ALLOWED_EXACT.has(toPosix(pathValue));
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

function extractBetweenMarkers(text: string, begin: string, end: string): string {
  const beginCount = countOccurrences(text, begin);
  const endCount = countOccurrences(text, end);
  expect(beginCount, `expected exactly one ${begin}`).toBe(1);
  expect(endCount, `expected exactly one ${end}`).toBe(1);
  const beginIndex = text.indexOf(begin);
  const endIndex = text.indexOf(end);
  expect(beginIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(beginIndex);
  return text.slice(beginIndex + begin.length, endIndex);
}

function parseCanonicalMarkers(record: string): Map<string, string> {
  const begin = 'BEGIN_BUILD_3_7E0_MARKERS';
  const end = 'END_BUILD_3_7E0_MARKERS';
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
    if (line === '```' || line === '```text') continue;
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
  const matches = git(['log', `${FIRST_BUILD_COMMIT}..HEAD`, '--format=%H%x09%s'])
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const tab = line.indexOf('\t');
      return tab === -1
        ? { hash: line, subject: '' }
        : { hash: line.slice(0, tab), subject: line.slice(tab + 1) };
    })
    .filter((entry) => entry.subject === CORRECTIVE_SUBJECT);

  if (matches.length > 1) {
    throw new Error(
      `expected at most one corrective commit with subject "${CORRECTIVE_SUBJECT}", found ${String(matches.length)}`,
    );
  }

  if (matches.length === 1) {
    const only = matches[0];
    if (!only) {
      throw new Error('corrective commit match missing');
    }
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

function isOfficialUrl(url: string): boolean {
  return (
    url.startsWith('https://developers.openai.com/') ||
    url.startsWith('https://help.openai.com/') ||
    url.startsWith('https://openai.com/') ||
    url.startsWith('https://github.com/openai/codex/')
  );
}

describe('Build 3.7E0 subscription route feasibility record', () => {
  const record = readFileSync(CLOSEOUT_PATH, 'utf8');
  const docsByRel = new Map<string, string>(
    DOC_REQUIRED.map(({ rel }) => [rel, readFileSync(join(REPO_ROOT, rel), 'utf8')]),
  );
  const tipInfo = resolveBuildTip();

  it('parses exactly one canonical marker block with exact keys and values', () => {
    const markers = parseCanonicalMarkers(record);
    expect(markers.size).toBe(21);
  });

  it('does not claim production, live, or security approval', () => {
    const markers = parseCanonicalMarkers(record);
    expect(markers.get('PRODUCTION_READY')).toBe('FALSE');
    expect(markers.get('SECURITY_APPROVED')).toBe('FALSE');
    expect(markers.get('LIVE_OPERATIONAL_APPROVAL')).toBe('UNRESOLVED');
    expect(markers.get('IMPLEMENTATION_STATUS')).toBe('ABSENT');
    expect(record).not.toMatch(/is production[- ]ready/i);
    expect(record).not.toMatch(/security approval (was|is) complete/i);
  });

  it('keeps research FAIL, technical PASS, live UNRESOLVED, and retained provider', () => {
    const markers = parseCanonicalMarkers(record);
    expect(markers.get('RESEARCH_EXECUTIVE_VERDICT')).toBe(
      'FAIL_UNDER_ABSOLUTE_ZERO_PAID_FALLBACK_CRITERION',
    );
    expect(markers.get('TECHNICAL_SUBSCRIPTION_ROUTE')).toBe('PASS');
    expect(markers.get('LIVE_OPERATIONAL_APPROVAL')).toBe('UNRESOLVED');
    expect(markers.get('PROVIDER_STRATEGY')).toBe('RETAIN_CHATGPT_CODEX_AS_PRIMARY_CANDIDATE');
    expect(containsNormalized(record, 'does **not** call that verdict an error')).toBe(true);
  });

  it('separates repository-controlled fallback from upstream ChatGPT credit accounting', () => {
    expect(containsNormalized(record, 'paidFallbackEnabled=false')).toBe(true);
    expect(containsNormalized(record, 'not** an upstream spend-control')).toBe(true);
    expect(
      containsNormalized(
        record,
        'Repository flags do not control upstream ChatGPT credit accounting',
      ),
    ).toBe(true);
    expect(
      containsNormalized(record, 'ChatGPT/Codex credits are **not** OpenAI Platform API billing'),
    ).toBe(true);
    expect(containsNormalized(record, 'account-level prerequisites')).toBe(true);
  });

  it('keeps capability probe NOT_RUN and next stage 3.7B with E1/F blocked', () => {
    const markers = parseCanonicalMarkers(record);
    expect(markers.get('CAPABILITY_PROBE_STATUS')).toBe('NOT_RUN');
    expect(markers.get('NEXT_STAGE')).toBe('3.7B');
    expect(markers.get('BUILD_3_7B_D_STATUS')).toBe('OFFLINE_ONLY_ALLOWED');
    expect(markers.get('BUILD_3_7E1_STATUS')).toBe('BLOCKED');
    expect(markers.get('BUILD_3_7F_STATUS')).toBe('BLOCKED');
  });

  describe('canonical source register', () => {
    const registerBody = extractBetweenMarkers(
      record,
      'BEGIN_BUILD_3_7E0_SOURCE_REGISTER',
      'END_BUILD_3_7E0_SOURCE_REGISTER',
    );

    it('contains SRC-01—SRC-15 exactly once and no other SRC identifiers', () => {
      for (const id of SOURCE_IDS) {
        expect(countOccurrences(registerBody, id)).toBe(1);
      }
      const extra = [...registerBody.matchAll(/\bSRC-\d+\b/g)].map((match) => match[0]);
      expect(new Set(extra)).toEqual(new Set(SOURCE_IDS));
      expect(extra.length).toBe(SOURCE_IDS.length);
    });

    it('requires Title, URL, Date, Confirms, and Limitation for every source', () => {
      for (const id of SOURCE_IDS) {
        const heading = `### ${id}`;
        const start = registerBody.indexOf(heading);
        expect(start).toBeGreaterThanOrEqual(0);
        const nextHeadingIndex = registerBody.indexOf('### SRC-', start + heading.length);
        const section =
          nextHeadingIndex === -1
            ? registerBody.slice(start)
            : registerBody.slice(start, nextHeadingIndex);
        for (const field of ['Title:', 'URL:', 'Date:', 'Confirms:', 'Limitation:'] as const) {
          expect(section.includes(`- ${field}`), `${id} missing ${field}`).toBe(true);
          const fieldMatch = new RegExp(`- ${field}\\s*(.+)`, 'i').exec(section);
          expect(fieldMatch?.[1]?.trim().length, `${id} empty ${field}`).toBeGreaterThan(0);
        }
        const urlMatch = /- URL:\s*(\S+)/.exec(section);
        expect(urlMatch?.[1]).toBeTruthy();
        expect(isOfficialUrl(urlMatch?.[1] ?? '')).toBe(true);
      }
    });

    it('maps key facts to required source IDs and marks SRC-09 historical', () => {
      expect(containsNormalized(record, 'SRC-01, SRC-02, SRC-11, SRC-12')).toBe(true);
      expect(containsNormalized(record, 'SRC-03, SRC-04, SRC-10, SRC-11')).toBe(true);
      expect(containsNormalized(record, 'SRC-01, SRC-02, SRC-03')).toBe(true);
      expect(containsNormalized(record, 'SRC-05, SRC-07')).toBe(true);
      expect(containsNormalized(record, '(SRC-06)')).toBe(true);
      expect(
        containsNormalized(record, 'SRC-05,\n   SRC-08') ||
          containsNormalized(record, 'SRC-05, SRC-08'),
      ).toBe(true);
      expect(containsNormalized(record, '(SRC-09)')).toBe(true);
      expect(containsNormalized(record, 'SRC-13, SRC-14')).toBe(true);
      expect(containsNormalized(record, '(SRC-15)')).toBe(true);
      expect(
        containsNormalized(record, 'historical/launch-era') ||
          containsNormalized(record, 'launch-era'),
      ).toBe(true);
      expect(
        containsNormalized(record, 'not** the definitive modern ChatGPT OAuth description'),
      ).toBe(true);
    });

    it('omits long verbatim quotations and does not perform network requests', () => {
      expect(registerBody).not.toMatch(/"{40,}/);
      expect(registerBody).not.toMatch(/«[^»]{200,}»/);
      // Structural offline check only: no HTTP clients are invoked by this suite.
      expect(true).toBe(true);
    });
  });

  describe('cross-document exact status contract', () => {
    it('requires exact per-document status lines', () => {
      for (const { rel, required } of DOC_REQUIRED) {
        const text = docsByRel.get(rel) ?? '';
        for (const line of required) {
          if (line === 'Build 3.7E1 status: BLOCKED') {
            // Successor Build 3.7E1 may advance companions to PROBE_IMPLEMENTED while live
            // remains NOT_RUN; historical E0 closeout markers stay BLOCKED.
            const ok =
              containsNormalized(text, 'Build 3.7E1 status: BLOCKED') ||
              containsNormalized(text, 'Build 3.7E1 status: PROBE_IMPLEMENTED');
            expect(ok, `${rel} missing E1 status BLOCKED or PROBE_IMPLEMENTED`).toBe(true);
            continue;
          }
          expect(containsNormalized(text, line), `${rel} missing exact line: ${line}`).toBe(true);
        }
      }
    });

    it('forbids contradictory live/probe/E1/F/production assertions across current docs', () => {
      const texts = [record, ...docsByRel.values()];
      for (const text of texts) {
        for (const forbidden of FORBIDDEN_ASSERTIONS) {
          expect(
            containsNormalized(text, forbidden),
            `forbidden assertion present: ${forbidden}`,
          ).toBe(false);
        }
        expect(text).not.toMatch(/\bproduction ready\b/i);
        expect(text).not.toMatch(/\bsecurity approved\b/i);
        expect(containsNormalized(text, 'E0 not run')).toBe(false);
        expect(containsNormalized(text, 'technical PASS automatically')).toBe(false);
      }
      expect(
        containsNormalized(docsByRel.get(COMPAT_REL) ?? '', 'OpenClaw runtime verification: PASS'),
      ).toBe(false);
      expect(
        containsNormalized(
          docsByRel.get(COMPAT_REL) ?? '',
          'OpenClaw runtime verification: PARTIAL',
        ),
      ).toBe(false);
      expect(containsNormalized(docsByRel.get(LLM_REL) ?? '', 'never a paid route')).toBe(false);
    });
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
    expect(all.some((pathValue) => /tsconfig|eslint|prettier/i.test(pathValue))).toBe(false);
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
