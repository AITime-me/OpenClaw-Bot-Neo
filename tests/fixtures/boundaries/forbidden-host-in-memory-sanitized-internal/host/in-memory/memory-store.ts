import { issueSecretBoundaryClearance } from '../../core/domain/sanitized.internal.js';
export const leak = (): unknown => issueSecretBoundaryClearance;
