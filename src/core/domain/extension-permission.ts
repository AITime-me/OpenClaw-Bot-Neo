import type { ExtensionPermission } from './extension-manifest.js';
import type { RuntimeRiskEvidence } from './extension-runtime-risk.internal.js';
import type { ActiveExtensionRegistration } from './extension-registry-entry.internal.js';
import type { CorrelationId } from './identity.js';

export interface ExtensionPermissionPolicy {
  /** Permissions explicitly granted by trusted deployment policy. */
  readonly deploymentAllowed: readonly ExtensionPermission[];
  /** Permissions allowed for the authenticated role. Director is not privileged here. */
  readonly roleAllowed: readonly ExtensionPermission[];
  /** Permissions allowed by Security Guard policy. */
  readonly securityAllowed: readonly ExtensionPermission[];
  /** Permissions allowed by the effective risk decision after manifest+runtime merge. */
  readonly riskAllowed: readonly ExtensionPermission[];
}

/**
 * Permission resolution input. Caller-controlled runtimeRisk strings and registered booleans are
 * intentionally absent. Only sealed active registration and sealed runtime risk evidence are accepted.
 */
export interface ExtensionPermissionRequest {
  readonly registration: ActiveExtensionRegistration | null;
  readonly runtimeRiskEvidence: RuntimeRiskEvidence | null;
  /** Operation binding that must match the sealed evidence correlation id. */
  readonly correlationId: CorrelationId;
  readonly policy: ExtensionPermissionPolicy;
  /** Trusted clock instant used for evidence freshness. */
  readonly now: Date;
  /** Any model-authored permission proposal is rejected rather than interpreted. */
  readonly modelRequestedPermissions?: unknown;
  /** Model output must never be able to override risk evidence. */
  readonly modelRiskOverride?: unknown;
}

export type ExtensionPermissionFailureCode =
  | 'UNKNOWN_EXTENSION'
  | 'DISABLED_EXTENSION'
  | 'PENDING_POLICY'
  | 'REJECTED_EXTENSION'
  | 'NOT_ACTIVE'
  | 'UNKNOWN_PERMISSION'
  | 'MODEL_PERMISSION_OVERRIDE'
  | 'MODEL_RISK_OVERRIDE'
  | 'DANGEROUS_PERMISSION_NOT_GRANTED'
  | 'APPROVAL_POLICY_REQUIRED'
  | 'APPROVAL_EFFECT_MISMATCH'
  | 'UNKNOWN_RISK'
  | 'MISSING_RISK'
  | 'STALE_RISK'
  | 'VERSION_MISMATCH'
  | 'POLICY_MISMATCH'
  | 'OPERATION_MISMATCH'
  | 'REGISTRATION_MISMATCH';

export type ExtensionPermissionDecision =
  | {
      readonly allowed: true;
      readonly effectivePermissions: readonly ExtensionPermission[];
      readonly effectiveRisk: import('./extension-risk.js').ExtensionRiskClass;
    }
  | {
      readonly allowed: false;
      readonly effectivePermissions: readonly [];
      readonly code: ExtensionPermissionFailureCode;
      readonly reason: string;
    };
