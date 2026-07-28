import type { ExtensionPermission } from './extension-manifest.js';
import type { ExtensionRiskClass } from './extension-risk.js';
import type { ActiveExtensionRegistration } from './extension-registry-entry.internal.js';

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
 * Permission resolution input. Caller-controlled `registered: boolean` is intentionally absent.
 * Only sealed active registration evidence is accepted.
 */
export interface ExtensionPermissionRequest {
  readonly registration: ActiveExtensionRegistration | null;
  /** Trusted runtime operation risk evidence. Missing/unknown values deny. */
  readonly runtimeRisk: ExtensionRiskClass | null;
  readonly policy: ExtensionPermissionPolicy;
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
  | 'VERSION_MISMATCH';

export type ExtensionPermissionDecision =
  | {
      readonly allowed: true;
      readonly effectivePermissions: readonly ExtensionPermission[];
      readonly effectiveRisk: ExtensionRiskClass;
    }
  | {
      readonly allowed: false;
      readonly effectivePermissions: readonly [];
      readonly code: ExtensionPermissionFailureCode;
      readonly reason: string;
    };
