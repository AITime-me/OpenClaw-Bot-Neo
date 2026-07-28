export interface UntrustedContent {
  readonly kind: 'untrusted-content';
  readonly value: string;
  readonly instructionsExecutable: false;
}
export const markUntrusted = (value: string): UntrustedContent => ({
  kind: 'untrusted-content',
  value,
  instructionsExecutable: false,
});
