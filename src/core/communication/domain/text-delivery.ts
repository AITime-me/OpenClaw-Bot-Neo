import type { PayloadDigest } from '../../domain/identity.js';

export type ValidatedTextOutputSource = 'llm' | 'deterministic-notice';

/**
 * Opaque validated outbound text capability.
 * Trust is WeakMap membership only — object shape and serialization are not proof.
 */
export type ValidatedTextOutput = {
  readonly kind?: never;
};

export interface ValidatedTextOutputView {
  readonly text: string;
  readonly source: ValidatedTextOutputSource;
  readonly payloadDigest: PayloadDigest;
  readonly byteLength: number;
}
