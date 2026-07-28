/**
 * Trusted application clock. Callers never supply the approval-validation timestamp; the
 * memory-write boundary reads it once from this port for the whole operation.
 */
export interface ClockPort {
  now(): Date;
}
