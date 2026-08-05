import type { PayloadDigest } from '../../domain/identity.js';
import { deepFreeze } from '../../domain/immutable.js';
import { err, ok, type Result } from '../../domain/result.js';
import {
  computeCommunicationTextDigest,
  MAX_MODEL_OUTPUT_UTF8_BYTES,
  MIN_MODEL_OUTPUT_UTF8_BYTES,
  normalizeAndValidateCommunicationText,
} from './communication-identity.js';
import type {
  ValidatedTextOutput,
  ValidatedTextOutputSource,
  ValidatedTextOutputView,
} from './text-delivery.js';

interface ValidatedTextOutputCanonical {
  readonly text: string;
  readonly source: ValidatedTextOutputSource;
  readonly payloadDigest: PayloadDigest;
  readonly byteLength: number;
}

const validatedTextOutputRegistry = new WeakMap<object, ValidatedTextOutputView>();
const validatedTextOutputCanonicalRegistry = new WeakMap<object, ValidatedTextOutputCanonical>();

const bindValidatedTextOutputSerializationGuards = (view: object): void => {
  Object.defineProperty(view, 'toJSON', {
    value: (): never => {
      throw new TypeError('ValidatedTextOutput is not serializable.');
    },
    enumerable: false,
    configurable: false,
    writable: false,
  });
};

const createValidatedTextOutputShell = (): ValidatedTextOutput => {
  const view = Object.create(null) as ValidatedTextOutput;
  bindValidatedTextOutputSerializationGuards(view);
  return Object.freeze(view);
};

export const isValidatedTextOutput = (value: unknown): value is ValidatedTextOutput =>
  typeof value === 'object' && value !== null && validatedTextOutputRegistry.has(value);

export const getValidatedTextOutputView = (
  value: ValidatedTextOutput,
): ValidatedTextOutputView | null => validatedTextOutputRegistry.get(value) ?? null;

/** Validated output equality is object identity only. */
export const validatedTextOutputsEqual = (
  left: ValidatedTextOutput,
  right: ValidatedTextOutput,
): boolean => left === right;

export type ValidatedTextOutputSealFailureCode =
  'INVALID_SOURCE' | 'INVALID_TEXT' | 'TEXT_TOO_SHORT' | 'TEXT_TOO_LARGE';

export interface ValidatedTextOutputSealFailure {
  readonly code: ValidatedTextOutputSealFailureCode;
  readonly reason: string;
}

const isValidatedTextOutputSource = (value: unknown): value is ValidatedTextOutputSource =>
  value === 'llm' || value === 'deterministic-notice';

/**
 * Seals outbound text that already passed TextOutputPolicy.
 * Only trusted policy code may call this module.
 */
export const sealValidatedTextOutput = (input: {
  readonly source: ValidatedTextOutputSource;
  readonly text: string;
}): Result<ValidatedTextOutput, ValidatedTextOutputSealFailure> => {
  if (!isValidatedTextOutputSource(input.source))
    return err({ code: 'INVALID_SOURCE', reason: 'Validated text output source is invalid.' });

  const normalized = normalizeAndValidateCommunicationText(
    input.text,
    MAX_MODEL_OUTPUT_UTF8_BYTES,
    'Validated text output',
  );
  if (!normalized.ok)
    return err({
      code:
        normalized.error.code === 'UTF8_TOO_LARGE'
          ? 'TEXT_TOO_LARGE'
          : normalized.error.code === 'EMPTY'
            ? 'TEXT_TOO_SHORT'
            : 'INVALID_TEXT',
      reason: normalized.error.reason,
    });

  const byteLength = new TextEncoder().encode(normalized.value).byteLength;
  if (byteLength < MIN_MODEL_OUTPUT_UTF8_BYTES)
    return err({ code: 'TEXT_TOO_SHORT', reason: 'Validated text output is too short.' });

  const payloadDigest = computeCommunicationTextDigest(normalized.value);
  const canonical: ValidatedTextOutputCanonical = deepFreeze({
    text: normalized.value,
    source: input.source,
    payloadDigest,
    byteLength,
  });
  const shell = createValidatedTextOutputShell();
  const view: ValidatedTextOutputView = deepFreeze({ ...canonical });
  validatedTextOutputRegistry.set(shell, view);
  validatedTextOutputCanonicalRegistry.set(shell, canonical);
  return ok(shell);
};

export const getValidatedTextOutputCanonical = (
  value: ValidatedTextOutput,
): ValidatedTextOutputCanonical | null => validatedTextOutputCanonicalRegistry.get(value) ?? null;
