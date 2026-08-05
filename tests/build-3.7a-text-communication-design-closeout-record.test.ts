import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const BUILD_BASE = 'b66237613edefffad0d691b863d7f2b8643fb5e1';
const DESIGN_COMMIT = '73b65527beb663bd8fac91d8d3fef6e69be764a6';
const CORRECTIVE_SUBJECT = 'docs(communication): correct Build 3.7A review findings';

const CLOSEOUT_REL = 'docs/validation/build-3.7a-text-communication-design-closeout.md';
const ARCH_REL = 'docs/communication/text-architecture.md';
const TRUST_REL = 'docs/communication/text-trust-and-threat-model.md';
const STATE_REL = 'docs/communication/text-state-machines.md';
const MAP_REL = 'docs/communication/text-implementation-map.md';

const CLOSEOUT_PATH = join(REPO_ROOT, CLOSEOUT_REL);
const ARCH_PATH = join(REPO_ROOT, ARCH_REL);
const TRUST_PATH = join(REPO_ROOT, TRUST_REL);
const STATE_PATH = join(REPO_ROOT, STATE_REL);
const MAP_PATH = join(REPO_ROOT, MAP_REL);

const HISTORICAL_CLOSEOUTS = [
  'docs/validation/build-3.5b-connector-platform-core-closeout.md',
  'docs/validation/build-3.6b-infrastructure-fleet-foundation-closeout.md',
  'docs/validation/codex-review-6-r6-h01-readiness-race-closeout.md',
  'docs/validation/codex-review-6-r6-h02-durable-memory-secret-boundary-closeout.md',
  'docs/validation/codex-review-6-r6-m01-retryable-durable-owner-closeout.md',
  'docs/validation/codex-review-6-r6-m02-production-node-gate-systemd-closeout.md',
  'docs/validation/codex-review-6-r6-m03-live-process-identity-closeout.md',
  'docs/validation/codex-review-6-r6-low-hardening-package-closeout.md',
] as const;

const ALLOWED_EXACT = new Set([
  'README.md',
  'docs/architecture.md',
  'docs/channels.md',
  'docs/llm-provider.md',
  'docs/openclaw-compatibility.md',
  'docs/security-policy.md',
  'docs/deployment.md',
  'docs/acceptance-criteria.md',
  'docs/roles.md',
  'docs/voice-profile.md',
  'docs/integrations.md',
  'docs/infrastructure-platform.md',
  'docs/connector-platform.md',
  CLOSEOUT_REL,
  'tests/build-3.7a-text-communication-design-closeout-record.test.ts',
]);

const FORBIDDEN_EXACT = ['package.json', 'package-lock.json', 'src/index.ts'] as const;

const MARKERS: ReadonlyArray<readonly [string, string]> = [
  ['BUILD_ID', '3.7A'],
  ['BUILD_KIND', 'DESIGN_ONLY'],
  ['IMPLEMENTATION_STATUS', 'ABSENT'],
  ['LIVE_TELEGRAM', 'ABSENT'],
  ['LIVE_LLM_ROUTE', 'ABSENT'],
  ['SUBSCRIPTION_ROUTE_STATUS', 'FEASIBILITY_REQUIRED'],
  ['ENCRYPTION_LIVE_GATE', 'BLOCKING'],
  ['PRODUCTION_READY', 'FALSE'],
  ['SECURITY_APPROVED', 'FALSE'],
  ['NEXT_GATE', '3.7E0'],
  ['CONNECTOR_TOOLS_ATTACHED', 'FALSE'],
  ['INFRASTRUCTURE_TOOLS_ATTACHED', 'FALSE'],
];

const ADMISSION_ORDER_BLOCK = [
  'NORMATIVE_ADMISSION_ORDER:',
  'sealed transport validation',
  '→ atomic observed admission',
  '→ duplicate stop',
  '→ owner binding',
  '→ authenticated',
  '→ accepted + conversationSequence',
].join('\n');

const NOTICE_PATH_BLOCK = [
  'llm_started',
  '→ llm_known_failed',
  '→ deterministic_notice_prepared',
  '→ output_validated',
  '→ delivery_started',
].join('\n');

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
  const posix = toPosix(pathValue);
  if (ALLOWED_EXACT.has(posix)) return true;
  if (posix.startsWith('docs/communication/')) return true;
  return false;
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
    .filter((entry) => entry.subject === CORRECTIVE_SUBJECT);

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

describe('Build 3.7A text communication design closeout record', () => {
  const record = readFileSync(CLOSEOUT_PATH, 'utf8');
  const architecture = readFileSync(ARCH_PATH, 'utf8');
  const trustModel = readFileSync(TRUST_PATH, 'utf8');
  const stateMachines = readFileSync(STATE_PATH, 'utf8');
  const implementationMap = readFileSync(MAP_PATH, 'utf8');
  const tipInfo = resolveBuildTip();

  describe('A. Closeout marker contract', () => {
    it('exposes normalized machine-readable markers', () => {
      const markers = parseMarkers(record);
      for (const [key, value] of MARKERS) {
        expect(markers.get(key)).toBe(value);
      }
    });

    it('keeps design-only disposition markers', () => {
      expect(record).toContain('BUILD_3_7A_TEXT_COMMUNICATION_DESIGN_CLOSED_DOCUMENTATION_ONLY');
      expect(record).toContain(
        'BUILD_3_7A_TEXT_COMMUNICATION_DESIGN_READY_FOR_FOCUSED_INDEPENDENT_REREVIEW',
      );
      expect(record).toContain(BUILD_BASE);
      expect(record).toContain(DESIGN_COMMIT);
      expect(record).toContain('build-3-7a-text-communication-design');
    });
  });

  describe('B. Structural scope validation', () => {
    it('limits Build 3.7A changed paths to the documentation allowlist', () => {
      const committed = changedPathsBetween(BUILD_BASE, tipInfo.tip);
      const working = tipInfo.includeWorkingTree ? workingTreePaths() : [];
      const all = [...new Set([...committed, ...working])];

      expect(all.length).toBeGreaterThan(0);
      for (const pathValue of all) {
        expect(isAllowedPath(pathValue), `disallowed path: ${pathValue}`).toBe(true);
      }
      for (const forbidden of FORBIDDEN_EXACT) {
        expect(all.includes(forbidden), `forbidden path present: ${forbidden}`).toBe(false);
      }
      expect(all.some((pathValue) => pathValue.startsWith('src/'))).toBe(false);
      expect(all.some((pathValue) => pathValue.startsWith('config/'))).toBe(false);
    });

    it('does not modify package exports, diagnostics modules, or adapters in Build scope', () => {
      const committed = changedPathsBetween(BUILD_BASE, tipInfo.tip);
      const working = tipInfo.includeWorkingTree ? workingTreePaths() : [];
      const all = [...new Set([...committed, ...working])];
      expect(all.some((pathValue) => pathValue.includes('neo-runtime-diagnostics'))).toBe(false);
      expect(all.some((pathValue) => pathValue.includes('/adapters/'))).toBe(false);
      expect(all.includes('src/index.ts')).toBe(false);
      expect(all.includes('package.json')).toBe(false);
    });
  });

  describe('C. Historical snapshot protection', () => {
    it('keeps historical closeout content hashes equal to Build base', () => {
      for (const relativePath of HISTORICAL_CLOSEOUTS) {
        const baseBlob = gitBlobId(`${BUILD_BASE}:${relativePath}`);
        const tipBlob = gitBlobId(`${tipInfo.tip}:${relativePath}`);
        expect(tipBlob).toBe(baseBlob);

        if (tipInfo.includeWorkingTree) {
          const worktreePath = join(REPO_ROOT, relativePath);
          expect(existsSync(worktreePath)).toBe(true);
          expect(worktreeBlobId(relativePath)).toBe(baseBlob);
        }
      }
    });
  });

  describe('D. Cross-document design consistency', () => {
    it('shares the normative admission order block', () => {
      for (const doc of [architecture, stateMachines, trustModel, implementationMap, record]) {
        expect(containsNormalized(doc, ADMISSION_ORDER_BLOCK)).toBe(true);
      }
    });

    it('forbids automatic LLM replay and delivery resend on outcome-unknown', () => {
      expect(containsNormalized(architecture, 'LLM_OUTCOME_UNKNOWN')).toBe(true);
      expect(containsNormalized(architecture, 'DELIVERY_OUTCOME_UNKNOWN')).toBe(true);
      expect(containsNormalized(stateMachines, '**no automatic** model re-invoke')).toBe(true);
      expect(containsNormalized(stateMachines, '**no automatic** resend')).toBe(true);
      expect(containsNormalized(trustModel, 'no automatic model retry')).toBe(true);
      expect(containsNormalized(trustModel, 'no automatic resend')).toBe(true);
      expect(containsNormalized(record, 'forbids automatic model replay')).toBe(true);
      expect(containsNormalized(record, 'forbids automatic resend')).toBe(true);
    });

    it('requires audit start before LLM and retains delivered on checkpoint/audit failure', () => {
      expect(containsNormalized(architecture, 'audit start before LLM')).toBe(true);
      expect(containsNormalized(stateMachines, 'Phase A')).toBe(true);
      expect(containsNormalized(stateMachines, 'LLM/delivery')).toBe(true);
      expect(containsNormalized(architecture, 'deliveryStatus=delivered')).toBe(true);
      expect(containsNormalized(architecture, 'checkpointStatus=failed')).toBe(true);
      expect(containsNormalized(architecture, 'CONVERSATION_CHECKPOINT_FAILED')).toBe(true);
      expect(containsNormalized(stateMachines, 'deliveryStatus=delivered')).toBe(true);
      expect(containsNormalized(trustModel, 'CONVERSATION_CHECKPOINT_FAILED')).toBe(true);
    });

    it('defines deterministic notice path and forbids it on LLM_OUTCOME_UNKNOWN', () => {
      expect(containsNormalized(stateMachines, NOTICE_PATH_BLOCK)).toBe(true);
      expect(containsNormalized(architecture, NOTICE_PATH_BLOCK)).toBe(true);
      expect(containsNormalized(stateMachines, 'deterministic notice **forbidden**')).toBe(true);
      expect(containsNormalized(architecture, 'deterministic notice is **forbidden**')).toBe(true);
      expect(containsNormalized(trustModel, 'Notice forbidden on `LLM_OUTCOME_UNKNOWN`')).toBe(
        true,
      );
    });

    it('keeps encryption live gate and separated capabilities', () => {
      expect(parseMarkers(record).get('ENCRYPTION_LIVE_GATE')).toBe('BLOCKING');
      expect(containsNormalized(architecture, 'AuthenticatedCommunicationPrincipal')).toBe(true);
      expect(containsNormalized(architecture, 'AuthenticatedMemoryAccess')).toBe(true);
      expect(containsNormalized(architecture, 'Two opaque capability families')).toBe(true);
      expect(containsNormalized(record, 'Communication principal ≠ memory authority')).toBe(true);
    });

    it('treats Telegram and private mobile as peer adapters', () => {
      expect(containsNormalized(architecture, 'peer adapters')).toBe(true);
      expect(
        containsNormalized(record, 'peer transport adapters') ||
          containsNormalized(record, 'peer adapter'),
      ).toBe(true);
      expect(containsNormalized(implementationMap, 'private-mobile')).toBe(true);
      expect(containsNormalized(implementationMap, 'telegram')).toBe(true);
    });

    it('keeps communication contracts package-private from root-reachable barrels', () => {
      expect(containsNormalized(implementationMap, 'package-private')).toBe(true);
      expect(containsNormalized(implementationMap, 'src/core/communication/')).toBe(true);
      expect(containsNormalized(implementationMap, 'root-reachable barrels')).toBe(true);
      expect(containsNormalized(implementationMap, 'src/core/domain/index.ts')).toBe(true);
      expect(containsNormalized(implementationMap, 'src/core/ports/index.ts')).toBe(true);
      expect(containsNormalized(record, 'root-reachable barrels')).toBe(true);
    });

    it('locks FIFO default 8 and range 2..64', () => {
      expect(containsNormalized(architecture, 'default = 8')).toBe(true);
      expect(containsNormalized(architecture, '2..64')).toBe(true);
      expect(containsNormalized(stateMachines, 'default = 8')).toBe(true);
      expect(containsNormalized(stateMachines, '2..64')).toBe(true);
      expect(
        containsNormalized(implementationMap, 'default = **8**') ||
          containsNormalized(implementationMap, 'default = 8'),
      ).toBe(true);
      expect(containsNormalized(implementationMap, '2..64')).toBe(true);
      expect(containsNormalized(record, 'default depth 8')).toBe(true);
      expect(containsNormalized(record, '2..64')).toBe(true);
    });

    it('records exact future verification and adapter paths without ambiguity markers', () => {
      expect(implementationMap).toContain(
        'src/core/communication/ports/communication-turn-ledger.port.ts',
      );
      expect(implementationMap).toContain(
        'src/host/storage/sqlite/communication/sqlite-communication-turn-ledger-port.ts',
      );
      expect(implementationMap).toContain(
        'tests/communication/communication-checkpoint-partial-failure.test.ts',
      );
      expect(implementationMap).toContain(
        'tests/communication/communication-deterministic-notice.test.ts',
      );
      expect(normalizeWs(implementationMap)).not.toMatch(/\bor identity extensions\b/i);
      expect(normalizeWs(implementationMap)).not.toMatch(/\bSQLite or approved\b/i);
      expect(normalizeWs(implementationMap)).not.toMatch(/\bLikely change\b/i);
      expect(normalizeWs(implementationMap)).not.toMatch(/src\/channels\/reference\/\*/);
    });
  });
});
