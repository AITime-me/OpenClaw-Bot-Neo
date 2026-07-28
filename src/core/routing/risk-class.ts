export type RiskClass = 'low' | 'medium' | 'high' | 'untrusted-input';
export const normalizeRisk = (value: unknown): RiskClass =>
  value === 'low' || value === 'medium' || value === 'untrusted-input' ? value : 'high';
