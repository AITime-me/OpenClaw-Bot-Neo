import { err, ok, type Result } from '../domain/index.js';
import type {
  MetadataScanReport,
  ScanReport,
  SensitiveCategory,
  SensitiveFinding,
  SensitiveSeverity,
} from '../domain/index.js';
import { snapshotPlainJsonDto, type JsonDto } from './json-dto-snapshot.js';

export interface ScannerFailure {
  readonly code: 'SCANNER_FAILURE' | 'INPUT_TOO_LARGE' | 'METADATA_TOO_COMPLEX';
  readonly reason: string;
}

/** Inputs above this size are refused instead of being partially scanned. */
export const MAX_SCAN_INPUT_LENGTH = 65_536;
/** Longest span searched for a closing quote before falling back to the end of the line. */
const MAX_QUOTED_VALUE_LENGTH = 4_096;
/**
 * Inclusive traversal budget for metadata nodes (leaves and nested containers).
 * Exactly MAX_METADATA_NODES visited descendant nodes pass; the next node is denied.
 * The root object itself is not charged so that 256 root-level leaves remain admissible.
 */
export const MAX_METADATA_NODES = 256;
/** Inclusive maximum nesting depth from the root (root = 0). Depth MAX+1 is denied. */
export const MAX_METADATA_DEPTH = 5;
/** Inclusive total length of all object key names visited during traversal. */
export const MAX_METADATA_TOTAL_KEY_LENGTH = 4_096;

const REDACTION_MARKER_PATTERN = /\[REDACTED#[a-z-]+\]/g;
const redactionMarker = (category: SensitiveCategory): string => `[REDACTED#${category}]`;

const SEVERITY_RANK: Readonly<Record<SensitiveSeverity, number>> = {
  medium: 1,
  high: 2,
  critical: 3,
};

interface Range {
  readonly start: number;
  readonly end: number;
}
interface RawFinding extends Range {
  readonly category: SensitiveCategory;
  readonly severity: SensitiveSeverity;
}

interface AssignmentDetector {
  readonly category: SensitiveCategory;
  readonly severity: SensitiveSeverity;
  readonly keyPattern: RegExp;
}

/**
 * Key patterns stop at the separator and tolerate a quoted key such as `"password":`; the value
 * boundary is resolved by a hand-written scan so quoted values with spaces are covered completely
 * instead of stopping at the first space.
 */
const ASSIGNMENT_DETECTORS: readonly AssignmentDetector[] = [
  {
    category: 'password',
    severity: 'high',
    keyPattern: /\b(?:password|passwd|pwd|passphrase)["']?\s*[:=]/gi,
  },
  {
    category: 'api-key',
    severity: 'critical',
    keyPattern:
      /\b(?:api[_-]?key|access[_-]?key|secret[_-]?key|auth[_-]?token|access[_-]?token|refresh[_-]?token)["']?\s*[:=]/gi,
  },
  {
    category: 'oauth-client-secret',
    severity: 'critical',
    keyPattern: /\b(?:client[_-]?secret|oauth[_-]?client[_-]?secret)["']?\s*[:=]/gi,
  },
  {
    category: 'webhook-signing-secret',
    severity: 'critical',
    keyPattern:
      /\b(?:webhook[_-]?(?:signing[_-]?)?secret|signing[_-]?secret|hmac[_-]?secret)["']?\s*[:=]/gi,
  },
  {
    category: 'api-key',
    severity: 'critical',
    keyPattern: /\b(?:secret|token)["']?\s*[:=]/gi,
  },
  { category: 'cookie', severity: 'high', keyPattern: /\b(?:set-cookie|cookie)["']?\s*[:=]/gi },
  {
    category: 'recovery-code',
    severity: 'critical',
    keyPattern: /\brecovery[_ -]?code["']?\s*[:=]/gi,
  },
  {
    category: 'aws-secret-key',
    severity: 'critical',
    keyPattern: /\b(?:aws[_-]?secret[_-]?(?:access[_-]?)?key|secretAccessKey)["']?\s*[:=]/gi,
  },
];

interface LiteralDetector {
  readonly category: SensitiveCategory;
  readonly severity: SensitiveSeverity;
  readonly pattern: RegExp;
}

/**
 * Linear patterns only: bounded character classes and no nested quantifiers, so there is no
 * obvious catastrophic backtracking.
 */
const LITERAL_DETECTORS: readonly LiteralDetector[] = [
  {
    category: 'private-key',
    severity: 'critical',
    pattern:
      /-----BEGIN[A-Z0-9 ]{0,40}PRIVATE KEY-----[\s\S]*?-----END[A-Z0-9 ]{0,40}PRIVATE KEY-----/g,
  },
  { category: 'telegram-bot-token', severity: 'critical', pattern: /\d{8,10}:[A-Za-z0-9_-]{30,}/g },
  {
    category: 'bearer-token',
    severity: 'critical',
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  },
  {
    category: 'github-token',
    severity: 'critical',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,255}|github_pat_[A-Za-z0-9_]{20,255})\b/g,
  },
  {
    category: 'aws-access-key',
    severity: 'critical',
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  },
  {
    category: 'google-api-key',
    severity: 'critical',
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  {
    category: 'jwt',
    severity: 'critical',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
];

/** An unterminated key block is redacted to the end of the input rather than left in place. */
const UNTERMINATED_PRIVATE_KEY = /-----BEGIN[A-Z0-9 ]{0,40}PRIVATE KEY-----/g;
const URL_CANDIDATE_PATTERN = /[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'`<>]+/g;
const SENSITIVE_KEY_NAME_PATTERN =
  /^(?:.*[._-])?(?:password|passwd|pwd|passphrase|secret|token|cookie|api[_-]?key|access[_-]?key|private[_-]?key|recovery[_-]?code|credentials?|authorization|client[_-]?secret|webhook[_-]?secret|signing[_-]?secret)$/i;

const lineEnd = (input: string, from: number): number => {
  const relative = input.slice(from).search(/[\r\n]/);
  return relative < 0 ? input.length : from + relative;
};

const skipInlineSpace = (input: string, from: number): number => {
  let index = from;
  while (index < input.length && (input[index] === ' ' || input[index] === '\t')) index += 1;
  return index;
};

/**
 * After a sensitive-key separator, tolerate inline spaces/tabs and exactly one LF or CRLF plus
 * trailing spaces/tabs. Multiple consecutive newlines are treated as an ambiguous multiline
 * assignment and must fail closed rather than produce an empty allow range.
 */
const skipAssignmentWhitespace = (
  input: string,
  from: number,
): { readonly index: number; readonly ambiguous: boolean } => {
  let index = skipInlineSpace(input, from);
  if (index < input.length && input[index] === '\r') {
    index += 1;
    if (index < input.length && input[index] === '\n') index += 1;
    index = skipInlineSpace(input, index);
  } else if (index < input.length && input[index] === '\n') {
    index += 1;
    index = skipInlineSpace(input, index);
  }
  if (index < input.length && (input[index] === '\n' || input[index] === '\r'))
    return { index, ambiguous: true };
  return { index, ambiguous: false };
};

/**
 * Resolves the end of an assignment value. Quoted values are consumed up to the matching quote
 * (escaped quotes included) and unquoted values extend to the end of the line, which is the
 * documented wide boundary used whenever the real end is ambiguous.
 */
const assignmentValueEnd = (input: string, valueStart: number): number => {
  const quote = input[valueStart];
  if (quote !== '"' && quote !== "'") return lineEnd(input, valueStart);
  const limit = Math.min(input.length, valueStart + MAX_QUOTED_VALUE_LENGTH);
  let cursor = valueStart + 1;
  while (cursor < limit) {
    const char = input[cursor];
    if (char === '\\') {
      cursor += 2;
      continue;
    }
    if (char === quote) return cursor + 1;
    cursor += 1;
  }
  return lineEnd(input, valueStart);
};

const tryParseUrl = (value: string): URL | null => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const containsOnlyRedactionMarker = (value: string): boolean =>
  /^\s*(?:"|')?\[REDACTED#[a-z-]+\](?:"|')?\s*$/.test(value);

const collectProtectedRanges = (input: string): readonly Range[] =>
  [...input.matchAll(REDACTION_MARKER_PATTERN)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));

const isProtected = (protectedRanges: readonly Range[], range: Range): boolean =>
  protectedRanges.some((item) => range.start >= item.start && range.end <= item.end);

const mergeFindings = (findings: readonly RawFinding[]): readonly RawFinding[] => {
  const sorted = [...findings].sort(
    (left, right) => left.start - right.start || right.end - left.end,
  );
  const merged: RawFinding[] = [];
  for (const finding of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || finding.start > previous.end) {
      merged.push(finding);
      continue;
    }
    const dominant =
      SEVERITY_RANK[finding.severity] > SEVERITY_RANK[previous.severity] ? finding : previous;
    merged[merged.length - 1] = {
      start: previous.start,
      end: Math.max(previous.end, finding.end),
      category: dominant.category,
      severity: dominant.severity,
    };
  }
  return merged;
};

const collectFindings = (
  input: string,
): { readonly findings: readonly RawFinding[]; readonly forceDeny: boolean } => {
  const protectedRanges = collectProtectedRanges(input);
  const findings: RawFinding[] = [];
  let forceDeny = false;
  const push = (finding: RawFinding): void => {
    if (finding.end <= finding.start) {
      // An empty range after a sensitive assignment must never collapse to allow.
      forceDeny = true;
      return;
    }
    if (isProtected(protectedRanges, finding)) return;
    findings.push(finding);
  };

  for (const detector of ASSIGNMENT_DETECTORS)
    for (const match of input.matchAll(detector.keyPattern)) {
      const afterSeparator = skipAssignmentWhitespace(input, match.index + match[0].length);
      if (afterSeparator.ambiguous) {
        forceDeny = true;
        push({
          start: match.index,
          end: Math.min(input.length, afterSeparator.index + 1),
          category: detector.category,
          severity: detector.severity === 'critical' ? 'critical' : 'high',
        });
        continue;
      }
      const valueStart = afterSeparator.index;
      if (valueStart >= input.length) {
        forceDeny = true;
        push({
          start: match.index,
          end: input.length === match.index ? match.index + match[0].length : input.length,
          category: detector.category,
          severity: detector.severity === 'critical' ? 'critical' : 'high',
        });
        continue;
      }
      const end = assignmentValueEnd(input, valueStart);
      if (end <= valueStart) {
        forceDeny = true;
        push({
          start: match.index,
          end: Math.max(valueStart + 1, match.index + match[0].length),
          category: detector.category,
          severity: detector.severity === 'critical' ? 'critical' : 'high',
        });
        continue;
      }
      if (containsOnlyRedactionMarker(input.slice(valueStart, end))) continue;
      push({ start: valueStart, end, category: detector.category, severity: detector.severity });
    }

  for (const detector of LITERAL_DETECTORS)
    for (const match of input.matchAll(detector.pattern))
      push({
        start: match.index,
        end: match.index + match[0].length,
        category: detector.category,
        severity: detector.severity,
      });

  const closedKeyBlocks = findings.filter((finding) => finding.category === 'private-key');
  for (const match of input.matchAll(UNTERMINATED_PRIVATE_KEY)) {
    const covered = closedKeyBlocks.some(
      (block) => match.index >= block.start && match.index < block.end,
    );
    if (covered) continue;
    push({
      start: match.index,
      end: input.length,
      category: 'private-key',
      severity: 'critical',
    });
  }

  for (const match of input.matchAll(URL_CANDIDATE_PATTERN)) {
    const trimmed = match[0].replace(/[.,;:!?)\]}]+$/, '');
    if (trimmed.length === 0) continue;
    const range = { start: match.index, end: match.index + trimmed.length };
    const parsed = tryParseUrl(trimmed);
    if (!parsed) {
      if (/^[^/]*\/\/[^/@]*@/.test(trimmed))
        push({ ...range, category: 'url-credentials', severity: 'critical' });
      continue;
    }
    if (parsed.username.length === 0 && parsed.password.length === 0) continue;
    const category: SensitiveCategory =
      parsed.protocol === 'http:' || parsed.protocol === 'https:'
        ? 'url-credentials'
        : 'connection-string';
    push({ ...range, category, severity: 'critical' });
  }

  return { findings: mergeFindings(findings), forceDeny };
};

const toFindings = (raw: readonly RawFinding[], location: string): readonly SensitiveFinding[] =>
  raw.map((finding) => ({
    category: finding.category,
    start: finding.start,
    end: finding.end,
    maskedPreview: redactionMarker(finding.category),
    severity: finding.severity,
    location,
  }));

const applyRedaction = (input: string, raw: readonly RawFinding[]): string => {
  let redacted = input;
  for (const finding of [...raw].reverse())
    redacted =
      redacted.slice(0, finding.start) +
      redactionMarker(finding.category) +
      redacted.slice(finding.end);
  return redacted;
};

/**
 * Critical categories deny the sink outright; lower severities are redacted so ordinary text can
 * still flow with the secret removed. Ambiguous empty assignment ranges force deny.
 */
const decide = (raw: readonly RawFinding[], forceDeny: boolean): 'allow' | 'redact' | 'deny' => {
  if (forceDeny) return 'deny';
  if (raw.length === 0) return 'allow';
  return raw.some((finding) => finding.severity === 'critical') ? 'deny' : 'redact';
};

export function scanSensitiveData(input: string): Result<ScanReport, ScannerFailure> {
  if (typeof input !== 'string')
    return err({ code: 'SCANNER_FAILURE', reason: 'Scanner input was not a string.' });
  if (input.length > MAX_SCAN_INPUT_LENGTH)
    return err({ code: 'INPUT_TOO_LARGE', reason: 'Scanner input exceeds the supported size.' });
  try {
    if (input.length === 0) return ok({ decision: 'allow', findings: [], redacted: '' });
    const collected = collectFindings(input);
    return ok({
      decision: decide(collected.findings, collected.forceDeny),
      findings: toFindings(collected.findings, 'text'),
      redacted: applyRedaction(input, collected.findings),
    });
  } catch {
    return err({ code: 'SCANNER_FAILURE', reason: 'Sensitive-data scan failed; sink denied.' });
  }
}

const hasControlOrNewline = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
};

/**
 * Metadata keys are scanned independently of values. A secret-like or control-bearing key denies
 * the whole metadata object; the raw key never appears in findings, redacted entries, audit or
 * errors.
 */
export const isUnsafeMetadataKey = (key: string): boolean => {
  if (typeof key !== 'string' || key.length === 0) return true;
  if (hasControlOrNewline(key)) return true;
  if (SENSITIVE_KEY_NAME_PATTERN.test(key)) return true;
  const scanned = scanSensitiveData(key);
  if (!scanned.ok) return true;
  return scanned.value.findings.length > 0 || scanned.value.decision !== 'allow';
};

const SAFE_KEY_LOCATION = '[redacted-key]';

interface MetadataBudget {
  nodes: number;
  keyChars: number;
}

/**
 * Bounded fail-closed metadata flatten over an already-trusted plain JSON DTO snapshot.
 * Charges every visited descendant node (leaf or container) before descending.
 */
const flattenMetadata = (
  value: JsonDto,
  path: string,
  depth: number,
  sink: Map<string, string>,
  keys: string[],
  budget: MetadataBudget,
  chargeNode: boolean,
): boolean => {
  if (depth > MAX_METADATA_DEPTH) return false;
  if (chargeNode) {
    if (budget.nodes >= MAX_METADATA_NODES) return false;
    budget.nodes += 1;
  }
  if (value === null) {
    sink.set(path, '');
    return true;
  }
  if (typeof value === 'string') {
    sink.set(path, value);
    return true;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    sink.set(path, String(value));
    return true;
  }
  if (Array.isArray(value)) {
    const items: readonly JsonDto[] = value;
    for (let index = 0; index < items.length; index += 1) {
      const item = items.at(index);
      if (item === undefined) return false;
      if (!flattenMetadata(item, `${path}[${String(index)}]`, depth + 1, sink, keys, budget, true))
        return false;
    }
    return true;
  }

  for (const key of Object.keys(value)) {
    if (budget.keyChars + key.length > MAX_METADATA_TOTAL_KEY_LENGTH) return false;
    budget.keyChars += key.length;
    keys.push(key);
    const record = value as { readonly [key: string]: JsonDto };
    const item = record[key];
    if (item === undefined) return false;
    if (
      !flattenMetadata(
        item,
        path.length === 0 ? key : `${path}.${key}`,
        depth + 1,
        sink,
        keys,
        budget,
        true,
      )
    )
      return false;
  }
  return true;
};

/**
 * Scans metadata after a mandatory plain-JSON DTO snapshot. Getters, setters, methods, proxies,
 * host objects and non-plain prototypes fail closed without executing user code on the snapshot
 * path. Raw Proxies are rejected via `util.types.isProxy` before property enumeration.
 */
export function scanSensitiveMetadata(input: unknown): Result<MetadataScanReport, ScannerFailure> {
  if (input === null || typeof input !== 'object' || Array.isArray(input))
    return err({ code: 'SCANNER_FAILURE', reason: 'Metadata input was not an object.' });

  const snapshot = snapshotPlainJsonDto(input, {
    maxNodes: MAX_METADATA_NODES + 8,
    maxDepth: MAX_METADATA_DEPTH + 2,
  });
  if (!snapshot.ok)
    return err({
      code: 'METADATA_TOO_COMPLEX',
      reason: 'Metadata exceeds scan limits or is not a trusted plain JSON DTO.',
    });
  if (
    snapshot.value === null ||
    typeof snapshot.value !== 'object' ||
    Array.isArray(snapshot.value)
  )
    return err({ code: 'SCANNER_FAILURE', reason: 'Metadata input was not an object.' });

  const flat = new Map<string, string>();
  const keys: string[] = [];
  const budget: MetadataBudget = { nodes: 0, keyChars: 0 };
  let traversed: boolean;
  try {
    traversed = flattenMetadata(snapshot.value, '', 0, flat, keys, budget, false);
  } catch {
    return err({ code: 'METADATA_TOO_COMPLEX', reason: 'Metadata exceeds scan limits.' });
  }
  if (!traversed)
    return err({ code: 'METADATA_TOO_COMPLEX', reason: 'Metadata exceeds scan limits.' });

  for (const key of keys)
    if (isUnsafeMetadataKey(key))
      return ok({
        decision: 'deny',
        findings: [
          {
            category: 'unknown-sensitive-pattern',
            start: 0,
            end: 0,
            maskedPreview: redactionMarker('unknown-sensitive-pattern'),
            severity: 'critical',
            location: SAFE_KEY_LOCATION,
          },
        ],
        redactedEntries: {},
      });

  const findings: SensitiveFinding[] = [];
  const redactedEntries: Record<string, string> = {};
  let decision: 'allow' | 'redact' | 'deny' = 'allow';
  for (const [path, value] of flat) {
    const lastSegment = path.includes('.')
      ? (path.split('.').pop() ?? path)
      : path.replace(/\[\d+\]/g, '');
    if (SENSITIVE_KEY_NAME_PATTERN.test(lastSegment) && value.length > 0) {
      if (!containsOnlyRedactionMarker(value)) {
        findings.push({
          category: 'unknown-sensitive-pattern',
          start: 0,
          end: value.length,
          maskedPreview: redactionMarker('unknown-sensitive-pattern'),
          severity: 'critical',
          location: SAFE_KEY_LOCATION,
        });
        decision = 'deny';
        continue;
      }
      continue;
    }
    const scanned = scanSensitiveData(value);
    if (!scanned.ok) return err(scanned.error);
    redactedEntries[path] = scanned.value.redacted;
    for (const finding of scanned.value.findings)
      findings.push({
        ...finding,
        location: SAFE_KEY_LOCATION,
      });
    if (scanned.value.decision === 'deny') decision = 'deny';
    else if (scanned.value.decision === 'redact' && decision === 'allow') decision = 'redact';
  }
  if (decision === 'deny') return ok({ decision, findings, redactedEntries: {} });
  return ok({ decision, findings, redactedEntries });
}

/** Any scanner failure collapses to a deny decision and an input-free placeholder. */
export function scanWithFailClosed(
  input: string,
  scanner: (value: string) => Result<ScanReport, ScannerFailure> = scanSensitiveData,
): ScanReport {
  const result = scanner(input);
  return result.ok
    ? result.value
    : { decision: 'deny', findings: [], redacted: redactionMarker('unknown-sensitive-pattern') };
}
