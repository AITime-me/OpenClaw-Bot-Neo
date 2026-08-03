/**
 * Bounded child stderr drain + redacted evidence summary for Linux gate children.
 */
import { detectRedactionViolations } from './redaction.ts';

export const CHILD_STDERR_EVIDENCE_CAP = 8192;
export const STDERR_TRUNCATION_MARKER = '[stderr-truncated]';
/** Extra raw bytes retained past the evidence cap so secrets/paths split at the boundary can redact. */
export const CHILD_STDERR_LOOKAHEAD_BYTES = 4096;

export type ChildStderrRedactionPaths = {
  readonly repositoryRoot: string;
  readonly homePath: string;
  readonly tmpPath: string;
  readonly storageRoot: string;
  readonly executionRoot: string;
};

export type ChildStartupDiagnosticClass =
  'CHILD_STARTUP_MODULE_LOAD' | 'CHILD_STARTUP_ERROR' | 'CHILD_LIFECYCLE';

export type ChildStartupDiagnostics = {
  readonly diagnosticClass: ChildStartupDiagnosticClass;
  readonly exitCode: number | null;
  readonly protocolEventCount: number;
  readonly stderrTruncated: boolean;
  readonly stderrSummary: string;
};

export type ChildStderrCollector = {
  readonly ingest: (chunk: Buffer | string) => void;
  readonly markStreamError: (reason: string) => void;
  readonly snapshot: () => {
    readonly truncated: boolean;
    readonly rawForRedaction: string;
    readonly totalBytesSeen: number;
  };
};

const toFileUrlVariants = (absolutePath: string): readonly string[] => {
  const posix = absolutePath.replace(/\\/g, '/');
  const variants = new Set<string>();
  variants.add(posix);
  variants.add(absolutePath);
  if (posix.startsWith('/')) {
    variants.add(`file://${posix}`);
    variants.add(`file:///${posix.replace(/^\//, '')}`);
  } else {
    variants.add(`file:///${posix}`);
    variants.add(`file:///${posix.replace(/\\/g, '/')}`);
  }
  // Windows drive letter file URLs
  if (/^[A-Za-z]:[\\/]/.test(absolutePath)) {
    const driveChar = absolutePath.charAt(0);
    const drive = driveChar.toLowerCase();
    const rest = absolutePath.slice(2).replace(/\\/g, '/');
    variants.add(`file:///${drive}:${rest}`);
    variants.add(`file:///${drive.toUpperCase()}:${rest}`);
  }
  return [...variants];
};

export const createChildStderrCollector = (
  evidenceCap: number = CHILD_STDERR_EVIDENCE_CAP,
  lookahead: number = CHILD_STDERR_LOOKAHEAD_BYTES,
): ChildStderrCollector => {
  const retainCap = evidenceCap + Math.min(lookahead, 4096);
  const chunks: Buffer[] = [];
  let retainedBytes = 0;
  let totalBytesSeen = 0;
  let truncated = false;
  let streamError: string | null = null;

  const ingest = (chunk: Buffer | string): void => {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
    totalBytesSeen += buf.length;
    if (retainedBytes >= retainCap) {
      truncated = true;
      return;
    }
    const remaining = retainCap - retainedBytes;
    if (buf.length <= remaining) {
      chunks.push(buf);
      retainedBytes += buf.length;
      return;
    }
    chunks.push(buf.subarray(0, remaining));
    retainedBytes += remaining;
    truncated = true;
  };

  return {
    ingest,
    markStreamError: (reason: string) => {
      streamError = reason;
    },
    snapshot: () => {
      const raw = Buffer.concat(chunks, retainedBytes).toString('utf8');
      const withError =
        streamError === null
          ? raw
          : raw.length > 0
            ? `${raw}\n<stderr-stream-error:${streamError}>`
            : `<stderr-stream-error:${streamError}>`;
      return {
        truncated: truncated || totalBytesSeen > evidenceCap,
        rawForRedaction: withError,
        totalBytesSeen,
      };
    },
  };
};

const replaceLongestFirst = (
  input: string,
  replacements: ReadonlyArray<readonly [string, string]>,
): string => {
  const sorted = [...replacements].sort((a, b) => b[0].length - a[0].length);
  let output = input;
  for (const [from, to] of sorted) {
    if (from.length === 0) continue;
    if (!output.includes(from)) continue;
    output = output.split(from).join(to);
  }
  return output;
};

/** Drop stack frames and errno/fd dumps that trip evidence violation detectors. */
const stripUnsafeDiagnosticNoise = (text: string): string =>
  text
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (/^at\s+/.test(trimmed)) return false;
      if (/\berrno\b\s*[:=]/i.test(trimmed)) return false;
      if (/\bfd\b\s*[:=]/i.test(trimmed)) return false;
      if (/\bcause\b\s*[:=]/i.test(trimmed)) return false;
      return true;
    })
    .join('\n');

export const redactChildStderrSummary = (
  raw: string,
  paths: ChildStderrRedactionPaths,
  secretValues: readonly string[] = [],
  evidenceCap: number = CHILD_STDERR_EVIDENCE_CAP,
  truncated: boolean = false,
): { readonly summary: string; readonly truncated: boolean } => {
  const replacements: Array<readonly [string, string]> = [];
  for (const variant of toFileUrlVariants(paths.repositoryRoot)) {
    replacements.push([variant, '<REPO>']);
  }
  for (const variant of toFileUrlVariants(paths.homePath)) {
    replacements.push([variant, '<HOME>']);
  }
  for (const variant of toFileUrlVariants(paths.tmpPath)) {
    replacements.push([variant, '<TMP>']);
  }
  for (const variant of toFileUrlVariants(paths.storageRoot)) {
    replacements.push([variant, '<STORAGE>']);
  }
  for (const variant of toFileUrlVariants(paths.executionRoot)) {
    replacements.push([variant, '<EXECUTION>']);
  }
  for (const secret of secretValues) {
    if (secret.length > 0) replacements.push([secret, '<SECRET>']);
  }

  let redacted = replaceLongestFirst(raw, replacements);
  redacted = stripUnsafeDiagnosticNoise(redacted);

  let outTruncated = truncated;
  if (Buffer.byteLength(redacted, 'utf8') > evidenceCap) {
    let cut = redacted;
    while (
      Buffer.byteLength(cut, 'utf8') >
      evidenceCap - Buffer.byteLength(`\n${STDERR_TRUNCATION_MARKER}`, 'utf8')
    ) {
      cut = cut.slice(0, Math.max(0, cut.length - 64));
    }
    redacted = `${cut}\n${STDERR_TRUNCATION_MARKER}`;
    outTruncated = true;
  } else if (outTruncated && !redacted.includes(STDERR_TRUNCATION_MARKER)) {
    const markerBudget = evidenceCap - Buffer.byteLength(`\n${STDERR_TRUNCATION_MARKER}`, 'utf8');
    if (Buffer.byteLength(redacted, 'utf8') > markerBudget) {
      let cut = redacted;
      while (Buffer.byteLength(cut, 'utf8') > markerBudget) {
        cut = cut.slice(0, Math.max(0, cut.length - 64));
      }
      redacted = `${cut}\n${STDERR_TRUNCATION_MARKER}`;
    } else {
      redacted = `${redacted}\n${STDERR_TRUNCATION_MARKER}`;
    }
  }

  const violations = detectRedactionViolations(redacted, secretValues);
  if (violations.length > 0) {
    return { summary: '<redacted>', truncated: outTruncated };
  }
  return { summary: redacted, truncated: outTruncated };
};

export const classifyChildStartupDiagnostic = (input: {
  readonly exitCode: number | null;
  readonly protocolEventCount: number;
  readonly stderrSummary: string;
  readonly sawReady: boolean;
}): ChildStartupDiagnosticClass => {
  if (!input.sawReady && /ERR_MODULE_NOT_FOUND/.test(input.stderrSummary)) {
    return 'CHILD_STARTUP_MODULE_LOAD';
  }
  if (!input.sawReady && input.protocolEventCount === 0) {
    return 'CHILD_STARTUP_ERROR';
  }
  return 'CHILD_LIFECYCLE';
};

export const buildChildStartupDiagnostics = (input: {
  readonly exitCode: number | null;
  readonly messages: readonly {
    readonly event: string;
    readonly runId?: string;
    readonly role?: string;
  }[];
  readonly collector: ChildStderrCollector;
  readonly paths: ChildStderrRedactionPaths;
  readonly secretValues?: readonly string[];
  readonly correlation?: { readonly runId: string; readonly role: string };
}): ChildStartupDiagnostics => {
  const snap = input.collector.snapshot();
  const redacted = redactChildStderrSummary(
    snap.rawForRedaction,
    input.paths,
    input.secretValues ?? [],
    CHILD_STDERR_EVIDENCE_CAP,
    snap.truncated,
  );
  const sawReady =
    input.correlation !== undefined
      ? input.messages.some(
          (message) =>
            message.event === 'READY' &&
            message.runId === input.correlation?.runId &&
            message.role === input.correlation?.role,
        )
      : input.messages.some((message) => message.event === 'READY');
  return {
    diagnosticClass: classifyChildStartupDiagnostic({
      exitCode: input.exitCode,
      protocolEventCount: input.messages.length,
      stderrSummary: redacted.summary,
      sawReady,
    }),
    exitCode: input.exitCode,
    protocolEventCount: input.messages.length,
    stderrTruncated: redacted.truncated,
    stderrSummary: redacted.summary,
  };
};
