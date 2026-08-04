import type { ISO8601 } from '../identity.js';
import type { InfrastructureLogResult } from './logs.js';
import { sealLogResult } from './logs.js';
import {
  MAX_LOG_BYTES,
  MAX_LOG_LINE_LENGTH,
  MAX_LOG_LINES,
  MAX_SANITIZE_INPUT_BYTES,
  redactSecretsInBuffer,
  stripAnsiAndUnsafeControlCharacters,
} from './bounds.js';

/**
 * Production log sanitization order:
 * 1. Bound raw input buffer (lines joined, UTF-8 byte cap).
 * 2. Strip ANSI and unsafe control characters (preserve \n and \t).
 * 3. Redact secrets on the complete bounded text (multiline PEM, tokens, etc.).
 * 4. Split into lines and apply per-line length, line count, and final byte caps.
 */
export const sanitizeBoundedLogPayload = (
  rawLines: readonly string[],
  maximumLines: number,
  maximumBytes: number,
  observedAt: ISO8601,
): InfrastructureLogResult => {
  const lineCap = Math.min(Math.max(1, maximumLines), MAX_LOG_LINES);
  const byteCap = Math.min(Math.max(1, maximumBytes), MAX_LOG_BYTES);

  let joined = '';
  for (const rawLine of rawLines) {
    if (joined.length > 0) joined += '\n';
    joined += rawLine;
    if (Buffer.byteLength(joined, 'utf8') > MAX_SANITIZE_INPUT_BYTES) {
      joined = Buffer.from(joined, 'utf8').subarray(0, MAX_SANITIZE_INPUT_BYTES).toString('utf8');
      break;
    }
  }

  const stripped = stripAnsiAndUnsafeControlCharacters(joined);
  const redacted = redactSecretsInBuffer(stripped.text);
  const controlCharacterReplacementCount = stripped.controlCount + redacted.controlCount;
  const redactionCount = redacted.redactionCount;

  const lines: string[] = [];
  let returnedBytes = 0;
  let truncated = false;

  for (const rawLine of redacted.text.split('\n')) {
    if (lines.length >= lineCap) {
      truncated = true;
      break;
    }
    const boundedLine = rawLine.slice(0, MAX_LOG_LINE_LENGTH);
    const lineBytes = Buffer.byteLength(boundedLine, 'utf8');
    if (returnedBytes + lineBytes > byteCap) {
      truncated = true;
      break;
    }
    returnedBytes += lineBytes;
    lines.push(boundedLine);
  }

  if (redacted.text.length > 0 && lines.length === 0 && !truncated) {
    truncated = true;
  }

  return sealLogResult({
    lines: Object.freeze(lines),
    contentTrust: 'untrusted',
    truncated,
    originalSizeKnown: true,
    returnedBytes,
    redactionCount,
    controlCharacterReplacementCount,
    observedAt,
  });
};
