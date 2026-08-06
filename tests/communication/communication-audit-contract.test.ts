import { describe, expect, it } from 'vitest';
import type {
  CommunicationAuditCompletionEvent,
  CommunicationAuditStartEvent,
} from '../../src/core/communication/ports/communication-audit.port.js';

const startKeys: readonly (keyof CommunicationAuditStartEvent)[] = [
  'turnId',
  'correlationId',
  'ownerId',
  'conversationId',
  'operationKind',
  'policyVersion',
  'idempotencyKey',
  'timestamp',
  'redactedMetadata',
];

const completionKeys: readonly (keyof CommunicationAuditCompletionEvent)[] = [
  'turnId',
  'correlationId',
  'ownerId',
  'conversationId',
  'operationKind',
  'policyVersion',
  'idempotencyKey',
  'auditStartIdempotencyKey',
  'timestamp',
  'deliveryStatus',
  'checkpointStatus',
  'auditStartStatus',
  'auditCompletionStatus',
  'errorCode',
  'redactedMetadata',
];

const forbiddenPromptFields = [
  'prompt',
  'ownerText',
  'rawPrompt',
  'promptText',
  'assembledPrompt',
  'textPrompt',
  'userText',
  'modelOutput',
  'transcript',
] as const;

describe('communication audit event contract', () => {
  it('does not expose raw prompt fields on start events', () => {
    for (const field of forbiddenPromptFields) {
      expect((startKeys as readonly string[]).includes(field)).toBe(false);
    }
  });

  it('does not expose raw prompt fields on completion events', () => {
    for (const field of forbiddenPromptFields) {
      expect((completionKeys as readonly string[]).includes(field)).toBe(false);
    }
  });
});
