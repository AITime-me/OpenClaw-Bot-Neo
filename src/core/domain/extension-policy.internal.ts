import type { ExtensionPermission } from './extension-manifest.js';
import { EXTENSION_PERMISSIONS } from './extension-manifest.js';
import { deepFreeze } from './immutable.js';
import {
  exactPlainObservation,
  exactStringArray,
  filledString,
  isFreshWindow,
  parseIsoInstant,
} from './observation-validation.js';

/**
 * Sealed current extension policy snapshot. Trust is WeakMap membership.
 * Request-level grant arrays are never sealed directly from caller input.
 */

export interface CurrentExtensionPolicySnapshot {
  readonly extensionId: string;
  readonly extensionVersion: string;
  readonly policyVersion: string;
  readonly riskPolicyVersion: string;
  readonly deploymentAllowed: readonly ExtensionPermission[];
  readonly roleAllowed: readonly ExtensionPermission[];
  readonly securityAllowed: readonly ExtensionPermission[];
  readonly riskAllowed: readonly ExtensionPermission[];
  readonly deploymentAuthorizationTtlMs: number;
  readonly runtimeEvidenceTtlMs: number;
  readonly voiceEvidenceTtlMs: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly provenance: 'trusted-extension-policy';
}

const policyRegistry = new WeakMap<object, CurrentExtensionPolicySnapshot>();

const PERMISSION_SET = new Set<string>(EXTENSION_PERMISSIONS);

const permissionList = (value: unknown): readonly ExtensionPermission[] | null => {
  const list = exactStringArray(value, PERMISSION_SET);
  return list as readonly ExtensionPermission[] | null;
};

const OBSERVATION_FIELDS = Object.freeze([
  'extensionId',
  'extensionVersion',
  'policyVersion',
  'riskPolicyVersion',
  'deploymentAllowed',
  'roleAllowed',
  'securityAllowed',
  'riskAllowed',
  'deploymentAuthorizationTtlMs',
  'runtimeEvidenceTtlMs',
  'voiceEvidenceTtlMs',
  'issuedAt',
  'expiresAt',
] as const);

export const sealCurrentExtensionPolicySnapshot = (
  observation: unknown,
  now: Date,
  expected: {
    readonly extensionId: string;
    readonly extensionVersion: string;
  },
): CurrentExtensionPolicySnapshot | null => {
  const plain = exactPlainObservation(observation, OBSERVATION_FIELDS);
  if (plain === null) return null;
  if (
    !filledString(plain.extensionId) ||
    !filledString(plain.extensionVersion) ||
    !filledString(plain.policyVersion) ||
    !filledString(plain.riskPolicyVersion)
  )
    return null;
  if (
    plain.extensionId !== expected.extensionId ||
    plain.extensionVersion !== expected.extensionVersion
  )
    return null;

  const deploymentAllowed = permissionList(plain.deploymentAllowed);
  const roleAllowed = permissionList(plain.roleAllowed);
  const securityAllowed = permissionList(plain.securityAllowed);
  const riskAllowed = permissionList(plain.riskAllowed);
  if (
    deploymentAllowed === null ||
    roleAllowed === null ||
    securityAllowed === null ||
    riskAllowed === null
  )
    return null;

  if (
    !Number.isSafeInteger(plain.deploymentAuthorizationTtlMs) ||
    (plain.deploymentAuthorizationTtlMs as number) <= 0 ||
    (plain.deploymentAuthorizationTtlMs as number) > 3_600_000 ||
    !Number.isSafeInteger(plain.runtimeEvidenceTtlMs) ||
    (plain.runtimeEvidenceTtlMs as number) <= 0 ||
    (plain.runtimeEvidenceTtlMs as number) > 3_600_000 ||
    !Number.isSafeInteger(plain.voiceEvidenceTtlMs) ||
    (plain.voiceEvidenceTtlMs as number) <= 0 ||
    (plain.voiceEvidenceTtlMs as number) > 3_600_000
  )
    return null;

  const issuedAt = parseIsoInstant(plain.issuedAt);
  const expiresAt = parseIsoInstant(plain.expiresAt);
  if (issuedAt === null || expiresAt === null || !isFreshWindow(issuedAt, expiresAt, now))
    return null;

  const sealed = deepFreeze({
    extensionId: plain.extensionId,
    extensionVersion: plain.extensionVersion,
    policyVersion: plain.policyVersion,
    riskPolicyVersion: plain.riskPolicyVersion,
    deploymentAllowed,
    roleAllowed,
    securityAllowed,
    riskAllowed,
    deploymentAuthorizationTtlMs: plain.deploymentAuthorizationTtlMs as number,
    runtimeEvidenceTtlMs: plain.runtimeEvidenceTtlMs as number,
    voiceEvidenceTtlMs: plain.voiceEvidenceTtlMs as number,
    issuedAt: plain.issuedAt as string,
    expiresAt: plain.expiresAt as string,
    provenance: 'trusted-extension-policy' as const,
  });
  policyRegistry.set(sealed, sealed);
  return sealed;
};

export const isCurrentExtensionPolicySnapshot = (
  value: unknown,
): value is CurrentExtensionPolicySnapshot =>
  typeof value === 'object' && value !== null && policyRegistry.has(value);

export const getCurrentExtensionPolicyCanonical = (
  value: CurrentExtensionPolicySnapshot,
): CurrentExtensionPolicySnapshot | null => policyRegistry.get(value) ?? null;
