import { verifiedMemoryWriteHasClearance } from '../../../core/domain/sanitized.internal.js';
export const leak = (): unknown => verifiedMemoryWriteHasClearance;
