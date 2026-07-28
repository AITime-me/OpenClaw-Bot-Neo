import { err, ok, validateOperationContext, type Result } from '../domain/index.js';
import type {
  ApprovalDemand,
  ApprovalFailureCode,
  ApprovalId,
  ISO8601,
  MemoryNamespace,
  MemoryProvenance,
  MemoryRecordId,
  MemoryRetentionPolicy,
  MemorySource,
  MemoryTrustLevel,
  PrivacyClassification,
  ProjectScope,
  ResourceRef,
  SafeMemoryAuditEvent,
  SafeScanDecision,
  SanitizedMetadata,
  SanitizedText,
  SensitiveCategory,
} from '../domain/index.js';
import {
  isAuthenticatedMemoryAccessContext,
  type AuthenticatedMemoryAccessContext,
} from '../domain/memory-access.internal.js';
import {
  getSanitizedMetadataCanonical,
  getSanitizedTextCanonical,
  isSanitizedMetadata,
  isSanitizedText,
  isVerifiedMemoryWrite,
  sealSanitizedMetadata,
  sealSanitizedText,
  sealVerifiedMemoryWrite,
} from '../domain/sanitized.internal.js';
import {
  authorizeMemoryAccess,
  classifyData,
  markUntrusted,
  validateApproval,
  type MemoryAuthorizationFailureCode,
} from '../policy/index.js';
import type {
  ApprovalPort,
  ClockPort,
  MemoryAuditPort,
  MemoryPolicyPort,
  MemoryPort,
  SensitiveDataScannerPort,
} from '../ports/index.js';
import { computePayloadDigest } from './payload-digest.js';

const MAX_CONTENT_LENGTH = 65_536;

export interface MemoryWriteDeps {
  readonly scanner: SensitiveDataScannerPort;
  readonly policy: MemoryPolicyPort;
  readonly approvals: ApprovalPort;
  readonly memory: MemoryPort;
  readonly audit: MemoryAuditPort;
  /** Trusted clock; callers never supply the approval-validation timestamp. */
  readonly clock: ClockPort;
}

/**
 * External memory command. Callers may supply only operation data, authenticated access context
 * (separately) and an optional approvalId. They must not supply a ready-made approval demand,
 * payload digest or validation timestamp.
 */
export interface MemoryWriteCommand {
  readonly recordId: MemoryRecordId;
  readonly targetNamespace: MemoryNamespace;
  readonly rawContent: string;
  readonly rawMetadata: Readonly<Record<string, unknown>>;
  readonly source: MemorySource;
  readonly retentionPolicy: MemoryRetentionPolicy;
  readonly approvalId: ApprovalId | null;
}

export interface MemoryWriteOutcome {
  readonly recordId: MemoryRecordId;
  readonly scanDecision: SafeScanDecision;
  readonly approvalId: ApprovalId | null;
}

export type MemoryWriteFailure =
  | { readonly code: 'INVALID_OPERATION_CONTEXT'; readonly detail: string }
  | { readonly code: 'INVALID_CONTENT'; readonly detail: string }
  | { readonly code: 'SCANNER_UNAVAILABLE' }
  | { readonly code: 'SCAN_DENIED'; readonly categories: readonly SensitiveCategory[] }
  | { readonly code: 'AUTHORIZATION_DENIED'; readonly reason: MemoryAuthorizationFailureCode }
  | { readonly code: 'POLICY_UNAVAILABLE' }
  | { readonly code: 'POLICY_DENIED'; readonly reason: string }
  | { readonly code: 'APPROVAL_REQUIRED' }
  | { readonly code: 'APPROVAL_UNAVAILABLE' }
  | { readonly code: 'APPROVAL_INVALID'; readonly reason: ApprovalFailureCode }
  | { readonly code: 'CONSUMPTION_FAILED' }
  | { readonly code: 'MEMORY_UNAVAILABLE' }
  | { readonly code: 'AUDIT_FAILED' }
  | { readonly code: 'DIGEST_FAILED' };

const trustFor = (source: MemorySource): MemoryTrustLevel =>
  source.kind === 'owner'
    ? 'owner-stated'
    : source.kind === 'monitor'
      ? 'system-derived'
      : 'untrusted-summary';

const classificationFor = (
  namespace: MemoryNamespace,
  source: MemorySource,
): PrivacyClassification =>
  namespace === 'security-restricted'
    ? classifyData('security')
    : source.kind === 'owner'
      ? classifyData('owner')
      : namespace === 'shared-public'
        ? classifyData('public')
        : classifyData('business');

const worstDecision = (left: SafeScanDecision, right: SafeScanDecision): SafeScanDecision =>
  left === 'redact' || right === 'redact' ? 'redact' : 'allow';

/** Single trusted timestamp for the whole memory-write operation. */
export function readTrustedTimestamp(clock: ClockPort): Date {
  return clock.now();
}

/** Deterministic NFC normalization for memory-write content. */
export function normalizeMemoryWriteContent(rawContent: string): string {
  return rawContent.normalize('NFC');
}

export function memoryWriteTarget(
  namespace: MemoryNamespace,
  recordId: MemoryRecordId,
): ResourceRef {
  return `memory/${namespace}/${recordId}` as ResourceRef;
}

/**
 * Builds the approval demand from the authenticated context and the actual operation that is about
 * to be written. Callers never construct this object.
 */
export function deriveMemoryWriteApprovalDemand(input: {
  readonly access: AuthenticatedMemoryAccessContext;
  readonly targetNamespace: MemoryNamespace;
  readonly recordId: MemoryRecordId;
  readonly content: SanitizedText;
  readonly metadata: SanitizedMetadata;
  readonly projectScope: ProjectScope;
}): ApprovalDemand {
  if (!isAuthenticatedMemoryAccessContext(input.access))
    throw new TypeError('Authenticated memory access evidence is required.');
  if (!isSanitizedText(input.content) || !isSanitizedMetadata(input.metadata))
    throw new TypeError('Canonical sanitized snapshot evidence is required.');
  const contentCanonical = getSanitizedTextCanonical(input.content);
  const metadataCanonical = getSanitizedMetadataCanonical(input.metadata);
  if (contentCanonical === null || metadataCanonical === null)
    throw new TypeError('Canonical sanitized snapshot is missing.');
  const target = memoryWriteTarget(input.targetNamespace, input.recordId);
  const payloadDigest = computePayloadDigest({
    effect: 'write',
    content: contentCanonical.value,
    metadata: metadataCanonical.entries,
    namespace: input.targetNamespace,
    target,
    recordId: input.recordId,
    projectScope: {
      primary: input.projectScope.primary,
      permitted: [...input.projectScope.permitted].sort(),
      crossProjectPermitted: input.projectScope.crossProjectPermitted,
    },
  });
  return {
    ownerId: input.access.ownerId,
    actorId: input.access.actorId,
    effect: 'write',
    target,
    namespace: input.targetNamespace,
    projectScope: input.projectScope,
    payloadDigest,
  };
}

const toIso = (instant: Date): ISO8601 => instant.toISOString() as ISO8601;

/**
 * Executable memory-write boundary. The order below is the security contract and is verified
 * structurally against this function body by scripts/verify-memory-isolation.mjs.
 */
export async function executeMemoryWrite(
  deps: MemoryWriteDeps,
  access: AuthenticatedMemoryAccessContext,
  command: MemoryWriteCommand,
): Promise<Result<MemoryWriteOutcome, MemoryWriteFailure>> {
  // 1. Validate the authenticated operation context and opaque access evidence.
  if (!isAuthenticatedMemoryAccessContext(access))
    return err({ code: 'INVALID_OPERATION_CONTEXT', detail: 'MISSING_ACCESS_CONTEXT' });
  const contextFailure = validateOperationContext(access.operation);
  if (contextFailure !== null)
    return err({ code: 'INVALID_OPERATION_CONTEXT', detail: contextFailure.code });

  // Trusted clock is read once for this operation; callers cannot supply command.now.
  const trustedNow = readTrustedTimestamp(deps.clock);
  const trustedIso = toIso(trustedNow);

  // 2. Normalize input and 3. mark untrusted content from non-owner sources.
  if (typeof command.rawContent !== 'string')
    return err({ code: 'INVALID_CONTENT', detail: 'Content must be a string.' });
  const normalized = normalizeMemoryWriteContent(command.rawContent);
  if (normalized.trim().length === 0)
    return err({ code: 'INVALID_CONTENT', detail: 'Content is empty.' });
  if (normalized.length > MAX_CONTENT_LENGTH)
    return err({ code: 'INVALID_CONTENT', detail: 'Content exceeds the supported size.' });

  const trustLevel = trustFor(command.source);
  const untrusted = markUntrusted(normalized);
  const candidate = trustLevel === 'owner-stated' ? normalized : untrusted.value;

  // 5. Scan text.
  const textScan = await deps.scanner.scanText(candidate, access.operation);
  if (!textScan.ok) return err({ code: 'SCANNER_UNAVAILABLE' });

  // 6. Scan metadata keys and values.
  const metadataScan = await deps.scanner.scanMetadata(command.rawMetadata, access.operation);
  if (!metadataScan.ok) return err({ code: 'SCANNER_UNAVAILABLE' });

  // 7. Deny or redact.
  if (textScan.value.decision === 'deny' || metadataScan.value.decision === 'deny')
    return err({
      code: 'SCAN_DENIED',
      categories: [...textScan.value.findings, ...metadataScan.value.findings].map(
        (finding) => finding.category,
      ),
    });
  const scanDecision = worstDecision(textScan.value.decision, metadataScan.value.decision);
  const content = sealSanitizedText(textScan.value.redacted, textScan.value.decision);
  const metadata = sealSanitizedMetadata(
    metadataScan.value.redactedEntries,
    metadataScan.value.decision,
  );

  // 8. Classify privacy.
  const privacyClassification = classificationFor(command.targetNamespace, command.source);

  // 9. Resolve and authorize the namespace from the authenticated context.
  const authorization = authorizeMemoryAccess(access, 'write', {
    ownerId: access.ownerId,
    namespace: command.targetNamespace,
  });
  if (!authorization.allowed)
    return err({ code: 'AUTHORIZATION_DENIED', reason: authorization.code });

  const provenance: MemoryProvenance = {
    capturedAt: trustedIso,
    initiatedBy: access.ownerId,
    transformation: trustLevel === 'owner-stated' ? 'owner-stated' : 'untrusted-source-summary',
    ownerApproved: false,
    crossProjectAccess: command.targetNamespace !== access.activeNamespace,
  };

  // 10. Apply the memory policy.
  const policyResult = await deps.policy.evaluate(
    {
      namespace: command.targetNamespace,
      content,
      metadata,
      privacyClassification,
      trustLevel,
      source: command.source,
      provenance,
      retentionPolicy: command.retentionPolicy,
    },
    access,
  );
  if (!policyResult.ok) return err({ code: 'POLICY_UNAVAILABLE' });
  if (policyResult.value.decision === 'deny')
    return err({ code: 'POLICY_DENIED', reason: policyResult.value.reason });

  // 11–13. Derive approval demand from the actual operation on the straight line, then
  // validate/consume only when policy requires approval (deny-path early returns stay stage-free).
  let approvalId: ApprovalId | null = null;
  const demand = deriveMemoryWriteApprovalDemand({
    access,
    targetNamespace: command.targetNamespace,
    recordId: command.recordId,
    content,
    metadata,
    projectScope: access.projectScope,
  });
  if (policyResult.value.decision === 'approval-required') {
    if (command.approvalId === null) return err({ code: 'APPROVAL_REQUIRED' });
    const grant = await deps.approvals.lookup(command.approvalId, access.operation);
    if (!grant.ok) return err({ code: 'APPROVAL_UNAVAILABLE' });
    const validated = validateApproval(grant.value, demand, trustedNow);
    if (!validated.ok) return err({ code: 'APPROVAL_INVALID', reason: validated.error.code });
    const consumed = await deps.approvals.consume(
      validated.value.approvalId,
      grant.value.nonce,
      access.operation,
    );
    if (!consumed.ok) return err({ code: 'CONSUMPTION_FAILED' });
    approvalId = validated.value.approvalId;
  }

  // 14. Write through the memory port using the sealed contract only.
  const verifiedWrite = sealVerifiedMemoryWrite({
    recordId: command.recordId,
    ownerId: access.ownerId,
    namespace: command.targetNamespace,
    content,
    metadata,
    source: command.source,
    provenance: { ...provenance, ownerApproved: approvalId !== null },
    privacyClassification,
    trustLevel,
    retentionPolicy: command.retentionPolicy,
    approvalId,
    createdAt: trustedIso,
    updatedAt: trustedIso,
  });
  if (verifiedWrite === null || !isVerifiedMemoryWrite(verifiedWrite))
    return err({ code: 'DIGEST_FAILED' });
  const written = await deps.memory.write(verifiedWrite, access);
  if (!written.ok) return err({ code: 'MEMORY_UNAVAILABLE' });

  // 15. Record safe audit metadata (no raw user-controlled metadata key names).
  const event: SafeMemoryAuditEvent = {
    correlationId: access.correlationId,
    ownerId: access.ownerId,
    actorId: access.actorId,
    role: access.role,
    action: 'memory-write',
    outcome: 'allowed',
    namespace: command.targetNamespace,
    recordId: written.value,
    privacyClassification,
    trustLevel,
    scanDecision,
    findingCategories: [...textScan.value.findings, ...metadataScan.value.findings].map(
      (finding) => finding.category,
    ),
    metadataFieldCount: Object.keys(metadata.entries).length,
    approvalId,
    occurredAt: trustedIso,
  };
  const audited = await deps.audit.record(event, access);
  if (!audited.ok) return err({ code: 'AUDIT_FAILED' });

  return ok({ recordId: written.value, scanDecision, approvalId });
}
