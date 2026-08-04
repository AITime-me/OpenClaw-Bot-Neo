export const INFRASTRUCTURE_ERROR_CODES = Object.freeze([
  'server-not-found',
  'service-not-found',
  'environment-not-found',
  'provider-not-found',
  'connection-not-found',
  'capability-denied',
  'policy-denied',
  'approval-required',
  'approval-denied',
  'provider-unavailable',
  'host-unreachable',
  'host-identity-mismatch',
  'operation-not-supported',
  'operation-timeout',
  'cancelled',
  'rate-limited',
  'invalid-provider-response',
  'invalid-host-response',
  'drift-detected',
  'outcome-unknown',
  'internal-error',
  'duplicate-registration',
  'environment-mismatch',
  'self-dependency',
  'invalid-input',
] as const);

export type InfrastructureErrorCode = (typeof INFRASTRUCTURE_ERROR_CODES)[number];

export interface InfrastructureError {
  readonly code: InfrastructureErrorCode;
  readonly reason: string;
}

export const infrastructureError = (
  code: InfrastructureErrorCode,
  reason: string,
): InfrastructureError => ({
  code,
  reason: reason.slice(0, 256),
});
