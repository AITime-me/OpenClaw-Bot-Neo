import type { ApprovalEffect } from './approval.js';
import type { PrivacyClassification } from './privacy.js';

export const EXTENSION_MANIFEST_SCHEMA_VERSION = '1.0' as const;

export const EXTENSION_KINDS = Object.freeze([
  'business-skill',
  'technical-skill',
  'channel',
  'integration',
] as const);
export type ExtensionKind = (typeof EXTENSION_KINDS)[number];

export const EXTENSION_PERMISSIONS = Object.freeze([
  'memory-read',
  'memory-write',
  'secrets-read',
  'exec',
  'external-send',
  'external-read',
  'webhook-ingest',
  'file-ingest',
  'media-process',
  'notifications-send',
  'schedule-write',
  'integration-write',
] as const);
export type ExtensionPermission = (typeof EXTENSION_PERMISSIONS)[number];

export const DANGEROUS_EXTENSION_PERMISSIONS = Object.freeze([
  'memory-write',
  'secrets-read',
  'exec',
  'external-send',
  'integration-write',
] as const satisfies readonly ExtensionPermission[]);

export const EXTENSION_PORTS = Object.freeze([
  'audio-analysis@1',
  'speech-to-text@1',
  'media-validation@1',
  'temporary-media-storage@1',
  'sensitive-data-scanner@1',
  'memory@1',
  'notifier@1',
  'scheduler@1',
  'channel@1',
  'integration@1',
  'webhook-source-authentication@1',
  'webhook-signature-verification@1',
  'webhook-replay-protection@1',
  'webhook-rate-limit@1',
] as const);
export type ExtensionPortId = (typeof EXTENSION_PORTS)[number];

export const EXTENSION_IO_KINDS = Object.freeze([
  'text',
  'structured-data',
  'audio',
  'image',
  'video',
  'document',
  'event',
  'notification',
] as const);
export type ExtensionInputKind = (typeof EXTENSION_IO_KINDS)[number];
export type ExtensionOutputKind = ExtensionInputKind;

export interface ExtensionApprovalPolicy {
  readonly mode: 'none' | 'required-for-dangerous' | 'always';
  readonly effects: readonly ApprovalEffect[];
}

export interface ExtensionProvenance {
  readonly status: 'verified' | 'unverified';
  readonly source: 'project' | 'trusted-deployment';
  readonly note: string;
}

export interface ExtensionOwnerScope {
  readonly mode: 'deployment-owner' | 'explicit-owner';
  readonly ownerReference: string;
}

/**
 * Declarative metadata only. It deliberately has no executable path, command, credential or
 * provider configuration field.
 */
export interface ExtensionManifest {
  readonly schemaVersion: typeof EXTENSION_MANIFEST_SCHEMA_VERSION;
  readonly id: string;
  readonly version: string;
  readonly kind: ExtensionKind;
  readonly displayName: string;
  readonly description: string;
  readonly declaredCapabilities: readonly string[];
  readonly requiredPorts: readonly ExtensionPortId[];
  readonly requestedPermissions: readonly ExtensionPermission[];
  readonly riskClass: 'low' | 'medium' | 'high' | 'untrusted-input';
  readonly approvalPolicy: ExtensionApprovalPolicy;
  readonly dataClassifications: readonly PrivacyClassification[];
  readonly supportedInputKinds: readonly ExtensionInputKind[];
  readonly supportedOutputKinds: readonly ExtensionOutputKind[];
  readonly configurationSchemaVersion: string;
  readonly enabled: boolean;
  readonly provenance: ExtensionProvenance;
  readonly ownerScope: ExtensionOwnerScope;
}

export type ExtensionManifestFailureCode =
  | 'INVALID_MANIFEST'
  | 'UNSUPPORTED_SCHEMA_VERSION'
  | 'UNKNOWN_KIND'
  | 'UNKNOWN_FIELD'
  | 'UNKNOWN_PERMISSION'
  | 'UNKNOWN_PORT'
  | 'INVALID_CAPABILITY_ID'
  | 'INVALID_VERSION'
  | 'MISSING_APPROVAL_POLICY'
  | 'APPROVAL_POLICY_REQUIRED'
  | 'SECRET_LIKE_CONTENT'
  | 'EXECUTABLE_CONTENT'
  | 'MUTABLE_MANIFEST';

export interface ExtensionManifestFailure {
  readonly code: ExtensionManifestFailureCode;
  readonly reason: string;
}
