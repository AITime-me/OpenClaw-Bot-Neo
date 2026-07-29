import { sealValidatedApproval } from '../core/domain/approval.internal.js';
export const leak = (value: unknown): unknown => sealValidatedApproval(value);
