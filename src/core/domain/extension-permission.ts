import type { ExtensionPermission } from './extension-manifest.js';
import type { VerifiedExtensionManifest } from './extension-manifest.internal.js';

export interface ExtensionPermissionPolicy {
  /** Permissions explicitly granted by trusted deployment policy. */
  readonly deploymentAllowed: readonly ExtensionPermission[];
  /** Permissions allowed for the authenticated role. Director is not privileged here. */
  readonly roleAllowed: readonly ExtensionPermission[];
  /** Permissions allowed by Security Guard policy. */
  readonly securityAllowed: readonly ExtensionPermission[];
  /** Permissions allowed by the current runtime risk decision. */
  readonly riskAllowed: readonly ExtensionPermission[];
}

export interface ExtensionPermissionRequest {
  readonly manifest: VerifiedExtensionManifest | null;
  readonly registered: boolean;
  readonly operationRisk: 'low' | 'medium' | 'high' | 'untrusted-input';
  readonly policy: ExtensionPermissionPolicy;
  /** Any model-authored permission proposal is rejected rather than interpreted. */
  readonly modelRequestedPermissions?: unknown;
}

export type ExtensionPermissionFailureCode =
  | 'UNKNOWN_EXTENSION'
  | 'DISABLED_EXTENSION'
  | 'UNKNOWN_PERMISSION'
  | 'MODEL_PERMISSION_OVERRIDE'
  | 'DANGEROUS_PERMISSION_NOT_GRANTED'
  | 'APPROVAL_POLICY_REQUIRED';

export type ExtensionPermissionDecision =
  | {
      readonly allowed: true;
      readonly effectivePermissions: readonly ExtensionPermission[];
    }
  | {
      readonly allowed: false;
      readonly effectivePermissions: readonly [];
      readonly code: ExtensionPermissionFailureCode;
      readonly reason: string;
    };
