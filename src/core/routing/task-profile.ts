import type { RiskClass } from './risk-class.js';
export interface TaskProfile {
  readonly risk: RiskClass;
  readonly requiresOwnerApproval: boolean;
  readonly trustedInput: boolean;
}
