import { err, ok, type Result } from '../../domain/result.js';
import type { OperationContext } from '../../domain/operation-context.js';
import type { SensitiveDataScannerPort } from '../../ports/sensitive-data-scanner.port.js';
import { outputRejectedFlags } from '../domain/communication-errors.js';
import type { CommunicationOperationalFlags, ValidatedTextOutput } from '../domain/index.js';
import type { ValidatedTextOutputSource } from '../domain/text-delivery.js';
import { sealValidatedTextOutput } from '../domain/text-delivery.internal.js';

export const DETERMINISTIC_NOTICE_TEXT =
  'I am temporarily unable to complete your request. Please try again later.' as const;

export const DETERMINISTIC_NOTICE_REASONS = Object.freeze([
  'provider-unavailable',
  'quota-unavailable',
  'known-timeout',
  'cancelled-before-invocation',
] as const);

export type DeterministicNoticeReason = (typeof DETERMINISTIC_NOTICE_REASONS)[number];

export const isDeterministicNoticeReason = (value: unknown): value is DeterministicNoticeReason =>
  typeof value === 'string' && (DETERMINISTIC_NOTICE_REASONS as readonly string[]).includes(value);

export interface TextOutputValidationInput {
  readonly source: ValidatedTextOutputSource;
  readonly text: string;
}

export type TextOutputValidationFailureCode =
  'INVALID_INPUT' | 'SECRET_SCAN_UNAVAILABLE' | 'OUTPUT_REJECTED';

export interface TextOutputValidationFailure {
  readonly code: TextOutputValidationFailureCode;
  readonly reason: string;
  readonly flags?: CommunicationOperationalFlags;
}

export type TextOutputValidationResult =
  | { readonly kind: 'validated'; readonly output: ValidatedTextOutput }
  | {
      readonly kind: 'rejected';
      readonly reason: string;
      readonly flags: CommunicationOperationalFlags;
    }
  | {
      readonly kind: 'scanner-unavailable';
      readonly reason: string;
      readonly flags: CommunicationOperationalFlags;
    };

const rejected = (reason: string): TextOutputValidationResult => ({
  kind: 'rejected',
  reason,
  flags: outputRejectedFlags(),
});

const scannerUnavailable = (reason: string): TextOutputValidationResult => ({
  kind: 'scanner-unavailable',
  reason,
  flags: outputRejectedFlags(),
});

/**
 * Validates outbound text and seals a genuine ValidatedTextOutput on success.
 */
export const validateTextOutput = async (
  input: TextOutputValidationInput,
  scanner: SensitiveDataScannerPort,
  operationContext: OperationContext,
): Promise<TextOutputValidationResult> => {
  const scanned = await scanner.scanText(input.text, operationContext);
  if (!scanned.ok) return scannerUnavailable('Sensitive data scanner is unavailable.');
  if (scanned.value.decision !== 'allow' || scanned.value.findings.length > 0)
    return rejected('Sensitive data scan rejected outbound text.');

  const sealed = sealValidatedTextOutput({
    source: input.source,
    text: input.text,
  });
  if (!sealed.ok) return rejected(sealed.error.reason);

  return { kind: 'validated', output: sealed.value };
};

export type DeterministicNoticeResult =
  | { readonly kind: 'notice'; readonly output: ValidatedTextOutput }
  | { readonly kind: 'forbidden'; readonly reason: string };

/**
 * Creates a deterministic system notice for known LLM failure reasons only.
 * Forbidden for outcome-unknown and operational unsafe states.
 */
export const createDeterministicNotice = async (
  reason: DeterministicNoticeReason,
  scanner: SensitiveDataScannerPort,
  operationContext: OperationContext,
): Promise<DeterministicNoticeResult> => {
  if (!isDeterministicNoticeReason(reason))
    return { kind: 'forbidden', reason: 'Notice reason is not in the known allowlist.' };

  const validated = await validateTextOutput(
    { source: 'deterministic-notice', text: DETERMINISTIC_NOTICE_TEXT },
    scanner,
    operationContext,
  );
  if (validated.kind !== 'validated') {
    return { kind: 'forbidden', reason: validated.reason };
  }

  return { kind: 'notice', output: validated.output };
};

export const validateTextOutputResult = (
  result: TextOutputValidationResult,
): Result<ValidatedTextOutput, TextOutputValidationFailure> => {
  switch (result.kind) {
    case 'validated':
      return ok(result.output);
    case 'rejected':
      return err({ code: 'OUTPUT_REJECTED', reason: result.reason, flags: result.flags });
    case 'scanner-unavailable':
      return err({
        code: 'SECRET_SCAN_UNAVAILABLE',
        reason: result.reason,
        flags: result.flags,
      });
    default: {
      const exhaustive: never = result;
      return err({
        code: 'INVALID_INPUT',
        reason: `Unexpected validation result: ${String(exhaustive)}`,
      });
    }
  }
};
