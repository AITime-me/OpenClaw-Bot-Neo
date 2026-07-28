import type { ApprovalEffect } from './approval.js';

/** Controlled extension risk classes. Unknown values must deny. */
export const EXTENSION_RISK_CLASSES = Object.freeze([
  'low',
  'medium',
  'high',
  'untrusted-input',
] as const);
export type ExtensionRiskClass = (typeof EXTENSION_RISK_CLASSES)[number];

/** Higher index is stricter. Do not compare risk strings lexicographically. */
export const EXTENSION_RISK_ORDER = Object.freeze({
  low: 0,
  medium: 1,
  high: 2,
  'untrusted-input': 3,
} as const satisfies Record<ExtensionRiskClass, number>);

export const isExtensionRiskClass = (value: unknown): value is ExtensionRiskClass =>
  typeof value === 'string' && (EXTENSION_RISK_CLASSES as readonly string[]).includes(value);

/**
 * Effective risk is the strictest of every provided controlled risk input.
 * Unknown or missing values are not treated as low.
 */
export function resolveEffectiveExtensionRisk(
  ...risks: readonly unknown[]
): { readonly ok: true; readonly risk: ExtensionRiskClass } | { readonly ok: false } {
  if (risks.length === 0) return { ok: false };
  let strictest: ExtensionRiskClass | null = null;
  for (const risk of risks) {
    if (!isExtensionRiskClass(risk)) return { ok: false };
    if (strictest === null || EXTENSION_RISK_ORDER[risk] > EXTENSION_RISK_ORDER[strictest])
      strictest = risk;
  }
  return strictest === null ? { ok: false } : { ok: true, risk: strictest };
}

/**
 * Dangerous permissions that leave the local trusted boundary or mutate external state.
 * Kept as a string catalog here to avoid a domain import cycle with extension-manifest.
 */
export const DANGEROUS_EXTENSION_PERMISSIONS = Object.freeze([
  'memory-write',
  'secrets-read',
  'exec',
  'external-send',
  'integration-write',
  'schedule-write',
  'notifications-send',
] as const);
export type DangerousExtensionPermission = (typeof DANGEROUS_EXTENSION_PERMISSIONS)[number];

export const isDangerousExtensionPermission = (
  permission: string,
): permission is DangerousExtensionPermission =>
  (DANGEROUS_EXTENSION_PERMISSIONS as readonly string[]).includes(permission);

/**
 * Explicit permission → required approval effect. Only controlled ApprovalEffect values are used.
 */
export const PERMISSION_APPROVAL_EFFECT_MAP = Object.freeze({
  'external-send': 'external-send',
  'memory-write': 'memory-write',
  'integration-write': 'integration-write',
  exec: 'exec',
  'schedule-write': 'schedule-write',
  'notifications-send': 'notifications-send',
  'secrets-read': 'secrets-read',
} as const satisfies Record<DangerousExtensionPermission, ApprovalEffect>);

export function requiredApprovalEffectFor(permission: string): ApprovalEffect | null {
  if (!isDangerousExtensionPermission(permission)) return null;
  return PERMISSION_APPROVAL_EFFECT_MAP[permission];
}
