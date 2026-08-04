export const TOOL_CAPABILITIES = Object.freeze([
  'read',
  'search',
  'list',
  'summarize',
  'create',
  'update',
  'delete',
  'send',
  'publish',
  'deploy',
  'restart',
  'administer',
] as const);

export type ToolCapability = (typeof TOOL_CAPABILITIES)[number];

export const TOOL_SIDE_EFFECT_CLASSES = Object.freeze([
  'READ_ONLY',
  'LOW_RISK_WRITE',
  'EXTERNAL_COMMUNICATION',
  'DESTRUCTIVE',
  'FINANCIAL',
  'INFRASTRUCTURE',
  'CREDENTIAL_OR_SECURITY_CHANGE',
] as const);

export type ToolSideEffectClass = (typeof TOOL_SIDE_EFFECT_CLASSES)[number];

export const TOOL_RISK_CLASSES = Object.freeze(['low', 'medium', 'high', 'critical'] as const);
export type ToolRiskClass = (typeof TOOL_RISK_CLASSES)[number];

export const APPROVAL_REQUIREMENTS = Object.freeze(['never', 'policy', 'always'] as const);
export type ApprovalRequirement = (typeof APPROVAL_REQUIREMENTS)[number];

export const NETWORK_REQUIREMENTS = Object.freeze(['none', 'egress-allowlisted'] as const);
export type NetworkRequirement = (typeof NETWORK_REQUIREMENTS)[number];

export const ACCOUNT_REQUIREMENTS = Object.freeze(['none', 'required'] as const);
export type AccountRequirement = (typeof ACCOUNT_REQUIREMENTS)[number];

export const IDEMPOTENCY_SUPPORTS = Object.freeze(['none', 'keyed'] as const);
export type IdempotencySupport = (typeof IDEMPOTENCY_SUPPORTS)[number];

export const CANCELLATION_SUPPORTS = Object.freeze(['cooperative', 'none'] as const);
export type CancellationSupport = (typeof CANCELLATION_SUPPORTS)[number];

export const DATA_SENSITIVITY_LEVELS = Object.freeze([
  'public',
  'internal',
  'confidential',
  'restricted',
] as const);
export type DataSensitivity = (typeof DATA_SENSITIVITY_LEVELS)[number];

export const isWriteLikeSideEffect = (sideEffect: ToolSideEffectClass): boolean =>
  sideEffect !== 'READ_ONLY';

export const isFinancialAction = (sideEffect: ToolSideEffectClass): boolean =>
  sideEffect === 'FINANCIAL';
