import { err, ok, type Result } from '../domain/index.js';
import type { ScanReport, SensitiveCategory, SensitiveFinding } from '../ports/index.js';

export interface ScannerFailure {
  readonly code: 'SCANNER_FAILURE';
  readonly reason: string;
}
interface Detector {
  readonly category: SensitiveCategory;
  readonly severity: SensitiveFinding['severity'];
  readonly pattern: RegExp;
}

const detectors: readonly Detector[] = [
  {
    category: 'private-key',
    severity: 'critical',
    pattern:
      /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/g,
  },
  {
    category: 'telegram-bot-token',
    severity: 'critical',
    pattern: /\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/g,
  },
  {
    category: 'bearer-token',
    severity: 'critical',
    pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi,
  },
  {
    category: 'url-credentials',
    severity: 'critical',
    pattern: /\bhttps?:\/\/[^\s/@:]+:[^\s/@]+@[^\s/]+/gi,
  },
  { category: 'password', severity: 'high', pattern: /\bpassword\s*[:=]\s*[^\s,;]+/gi },
  {
    category: 'api-key',
    severity: 'critical',
    pattern: /\b(?:api[_-]?key|access[_-]?key|secret[_-]?key)\s*[:=]\s*[^\s,;]+/gi,
  },
  {
    category: 'connection-string',
    severity: 'critical',
    pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s/@:]+:[^\s/@]+@[^\s]+/gi,
  },
  { category: 'cookie', severity: 'high', pattern: /\b(?:cookie|set-cookie)\s*[:=]\s*[^\r\n]+/gi },
  {
    category: 'recovery-code',
    severity: 'critical',
    pattern: /\brecovery[_ -]?code\s*[:=]\s*[^\s,;]+/gi,
  },
];

const preview = (category: SensitiveCategory): string => `[${category}:REDACTED]`;

export function scanSensitiveData(input: string): Result<ScanReport, ScannerFailure> {
  try {
    const findings: SensitiveFinding[] = [];
    const protectedRanges = [...input.matchAll(/\[[a-z-]+:REDACTED\]/g)].map((match) => ({
      start: match.index,
      end: match.index + match[0].length,
    }));
    for (const detector of detectors) {
      detector.pattern.lastIndex = 0;
      for (const match of input.matchAll(detector.pattern)) {
        const start = match.index;
        const end = start + match[0].length;
        if (protectedRanges.some((range) => start >= range.start && end <= range.end)) continue;
        findings.push({
          category: detector.category,
          start,
          end,
          maskedPreview: preview(detector.category),
          severity: detector.severity,
        });
      }
    }
    findings.sort((a, b) => a.start - b.start || b.end - a.end);
    const nonOverlapping = findings.filter(
      (item, index, list) => index === 0 || item.start >= (list[index - 1]?.end ?? 0),
    );
    let redacted = input;
    for (const finding of [...nonOverlapping].reverse())
      redacted =
        redacted.slice(0, finding.start) + finding.maskedPreview + redacted.slice(finding.end);
    return ok({
      decision: nonOverlapping.length === 0 ? 'allow' : 'deny',
      findings: nonOverlapping,
      redacted,
    });
  } catch {
    return err({ code: 'SCANNER_FAILURE', reason: 'Sensitive-data scan failed; sink denied.' });
  }
}

export function scanWithFailClosed(
  input: string,
  scanner: (value: string) => Result<ScanReport, ScannerFailure> = scanSensitiveData,
): ScanReport {
  const result = scanner(input);
  return result.ok
    ? result.value
    : { decision: 'deny', findings: [], redacted: '[SCAN_FAILED:REDACTED]' };
}
