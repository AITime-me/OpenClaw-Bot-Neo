import { seal } from '../../core/domain/approval.internal.js';
export const leak = (): unknown => seal;
