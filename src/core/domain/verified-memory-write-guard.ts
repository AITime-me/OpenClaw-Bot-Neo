import type { VerifiedMemoryWrite } from './index.js';
import { verifiedMemoryWriteHasClearance } from './sanitized.internal.js';

/**
 * Read-only sink guard: confirms a verified write passed the mandatory secret boundary.
 * Sinks import only this module — not clearance issuers, sealers, or secret readers.
 */
export const verifiedMemoryWriteHasSecretBoundaryClearance = (
  write: VerifiedMemoryWrite,
): boolean => verifiedMemoryWriteHasClearance(write);
