import type { NeoReadinessStatusDocument } from './parse-neo-readiness-document.js';
import type { ProcessInstanceIdentityProvider } from '../process-identity/process-instance-identity-provider.port.js';
import { normalizeBootId } from '../process-identity/validate-boot-id.js';
import { NEO_PROC_START_TIME_TICKS_MAX_LENGTH } from '../process-identity/parse-proc-stat.js';

export type NeoReadinessIdentityVerificationReason =
  | 'process-identity-missing'
  | 'process-identity-invalid'
  | 'process-identity-unavailable'
  | 'process-boot-mismatch'
  | 'process-absent'
  | 'process-zombie'
  | 'process-identity-mismatch';

export type NeoReadinessIdentityVerificationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: NeoReadinessIdentityVerificationReason };

const isDecimalTicks = (value: string): boolean =>
  value.length > 0 &&
  value.length <= NEO_PROC_START_TIME_TICKS_MAX_LENGTH &&
  /^[0-9]+$/.test(value);

const validateDocumentIdentity = (
  document: NeoReadinessStatusDocument,
): NeoReadinessIdentityVerificationResult => {
  const bootId = normalizeBootId(document.bootId);
  if (bootId === null) {
    return { ok: false, reason: 'process-identity-invalid' };
  }
  if (!isDecimalTicks(document.startTimeTicks)) {
    return { ok: false, reason: 'process-identity-invalid' };
  }
  if (!Number.isInteger(document.pid) || document.pid <= 0) {
    return { ok: false, reason: 'process-identity-invalid' };
  }
  return { ok: true };
};

const isZombieOrDeadState = (state: string): boolean => state === 'Z' || state === 'X';

export const verifyNeoReadinessProcessIdentity = async (
  document: NeoReadinessStatusDocument,
  provider: ProcessInstanceIdentityProvider,
): Promise<NeoReadinessIdentityVerificationResult> => {
  const identityCheck = validateDocumentIdentity(document);
  if (!identityCheck.ok) return identityCheck;

  const bootResult = await provider.readCurrentBootId();
  if (!bootResult.ok) {
    if (bootResult.error === 'process-absent') {
      return { ok: false, reason: 'process-absent' };
    }
    if (bootResult.error === 'unsupported-platform') {
      return { ok: false, reason: 'process-identity-unavailable' };
    }
    return { ok: false, reason: 'process-identity-unavailable' };
  }

  const normalizedBootId = normalizeBootId(document.bootId);
  if (normalizedBootId === null) {
    return { ok: false, reason: 'process-identity-invalid' };
  }
  if (bootResult.value !== normalizedBootId) {
    return { ok: false, reason: 'process-boot-mismatch' };
  }

  const observed = await provider.observe(document.pid);
  if (!observed.ok) {
    if (observed.error === 'process-absent') {
      return { ok: false, reason: 'process-absent' };
    }
    if (observed.error === 'process-zombie') {
      return { ok: false, reason: 'process-zombie' };
    }
    if (observed.error === 'unsupported-platform') {
      return { ok: false, reason: 'process-identity-unavailable' };
    }
    return { ok: false, reason: 'process-identity-unavailable' };
  }

  if (isZombieOrDeadState(observed.value.state)) {
    return { ok: false, reason: 'process-zombie' };
  }

  if (observed.value.startTimeTicks !== document.startTimeTicks) {
    return { ok: false, reason: 'process-identity-mismatch' };
  }

  if (observed.value.bootId !== normalizedBootId) {
    return { ok: false, reason: 'process-boot-mismatch' };
  }

  return { ok: true };
};
