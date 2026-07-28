import { err, ok, validateOperationContext, type Result } from '../domain/index.js';
import type {
  ApprovalDemand,
  ApprovalFailureCode,
  ApprovalId,
  ISO8601,
  MemoryAccessContext,
  MemoryNamespace,
  MemoryProvenance,
  MemoryRecordId,
  MemoryRetentionPolicy,
  MemorySource,
  MemoryTrustLevel,
  PrivacyClassification,
  SafeMemoryAuditEvent,
  SafeScanDecision,
  SensitiveCategory,
} from '../domain/index.js';
import {
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
  MemoryAuditPort,
  MemoryPolicyPort,
  MemoryPort,
  SensitiveDataScannerPort,
} from '../ports/index.js';

const MAX_CONTENT_LENGTH = 65_536;

export interface MemoryWriteDeps {
  readonly scanner: SensitiveDataScannerPort;
  readonly policy: MemoryPolicyPort;
  readonly approvals: ApprovalPort;
  readonly memory: MemoryPort;
  readonly audit: MemoryAuditPort;
}

export interface MemoryWriteApproval {
  readonly approvalId: ApprovalId;
  readonly demand: ApprovalDemand;
}

export interface MemoryWriteCommand {
  readonly recordId: MemoryRecordId;
  readonly targetNamespace: MemoryNamespace;
  readonly rawContent: string;
  readonly rawMetadata: Readonly<Record<string, unknown>>;
  readonly source: MemorySource;
  readonly retentionPolicy: MemoryRetentionPolicy;
  readonly approval: MemoryWriteApproval | null;
  readonly now: ISO8601;
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
  | { readonly code: 'AUDIT_FAILED' };

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

/**
 * Executable memory-write boundary. The order below is the security contract: the sensitive-data
 * scanner runs before any classification, authorization, policy check or sink call, and neither
 * the memory sink nor the audit sink can be reached with unscanned content.
 */
export async function executeMemoryWrite(
  deps: MemoryWriteDeps,
  access: MemoryAccessContext,
  command: MemoryWriteCommand,
): Promise<Result<MemoryWriteOutcome, MemoryWriteFailure>> {
  // 1. Validate the operation context.
  const contextFailure = validateOperationContext(access.operation);
  if (contextFailure !== null)
    return err({ code: 'INVALID_OPERATION_CONTEXT', detail: contextFailure.code });

  // 2. Normalize input.
  if (typeof command.rawContent !== 'string')
    return err({ code: 'INVALID_CONTENT', detail: 'Content must be a string.' });
  const normalized = command.rawContent.normalize('NFC');
  if (normalized.trim().length === 0)
    return err({ code: 'INVALID_CONTENT', detail: 'Content is empty.' });
  if (normalized.length > MAX_CONTENT_LENGTH)
    return err({ code: 'INVALID_CONTENT', detail: 'Content exceeds the supported size.' });

  // 3. Classify the source and 4. mark untrusted content before it is inspected.
  const trustLevel = trustFor(command.source);
  const candidate = trustLevel === 'owner-stated' ? normalized : markUntrusted(normalized).value;

  // 5. Scan text.
  const textScan = await deps.scanner.scanText(candidate, access.operation);
  if (!textScan.ok) return err({ code: 'SCANNER_UNAVAILABLE' });

  // 6. Scan metadata.
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
    capturedAt: command.now,
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

  // 11. Validate and consume the approval when one is required.
  let approvalId: ApprovalId | null = null;
  if (policyResult.value.decision === 'approval-required') {
    if (!command.approval) return err({ code: 'APPROVAL_REQUIRED' });
    const grant = await deps.approvals.lookup(command.approval.approvalId, access.operation);
    if (!grant.ok) return err({ code: 'APPROVAL_UNAVAILABLE' });
    const validated = validateApproval(grant.value, command.approval.demand, new Date(command.now));
    if (!validated.ok) return err({ code: 'APPROVAL_INVALID', reason: validated.error.code });
    const consumed = await deps.approvals.consume(
      validated.value.approvalId,
      command.approval.demand.nonce,
      access.operation,
    );
    if (!consumed.ok) return err({ code: 'CONSUMPTION_FAILED' });
    approvalId = validated.value.approvalId;
  }

  // 12. Write through the memory port using the sealed contract only.
  const written = await deps.memory.write(
    sealVerifiedMemoryWrite({
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
      createdAt: command.now,
      updatedAt: command.now,
    }),
    access,
  );
  if (!written.ok) return err({ code: 'MEMORY_UNAVAILABLE' });

  // 13. Record safe audit metadata.
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
    metadataKeys: Object.keys(metadataScan.value.redactedEntries),
    approvalId,
    occurredAt: command.now,
  };
  const audited = await deps.audit.record(event, access);
  if (!audited.ok) return err({ code: 'AUDIT_FAILED' });

  return ok({ recordId: written.value, scanDecision, approvalId });
}
