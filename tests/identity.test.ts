import { describe, expect, it } from 'vitest';
import {
  parseChannelId,
  parseCorrelationId,
  parseEventId,
  parseExtensionId,
  parseExtensionVersion,
  parseIdempotencyKey,
  parseISO8601,
  parseJobId,
  parseManifestDigest,
  parseMemoryRecordId,
  parseMessageId,
  parsePolicyVersion,
  parseProviderReference,
  parseReminderId,
  parseResourceRef,
  parseScheduledJobId,
  parseSessionId,
  type CorrelationId,
  type MessageId,
  type OutgoingMessage,
} from '../src/core/domain/index.js';
import * as publicApi from '../src/index.js';

describe('validated identity constructors', () => {
  it('parses MessageId and CorrelationId as distinct runtime-validated types', () => {
    const message = parseMessageId('msg-1');
    const correlation = parseCorrelationId('corr-1');
    expect(message.ok).toBe(true);
    expect(correlation.ok).toBe(true);
    if (!message.ok || !correlation.ok) return;
    const outgoing: OutgoingMessage = {
      correlationId: correlation.value,
      target: { kind: 'telegram', opaqueId: 'chat-1' },
      content: 'hello',
    };
    expect(outgoing.correlationId).toBe(correlation.value);
    // Type-level: MessageId is not assignable to CorrelationId without an explicit conversion.
    const asMessage: MessageId = message.value;
    const asCorrelation: CorrelationId = correlation.value;
    expect(asMessage).not.toBe(asCorrelation);
  });

  it('denies empty, whitespace, control and oversized values', () => {
    expect(parseMessageId('').ok).toBe(false);
    expect(parseCorrelationId(' has-space').ok).toBe(false);
    expect(parseEventId('a\nb').ok).toBe(false);
    expect(parseIdempotencyKey('x'.repeat(200)).ok).toBe(false);
    expect(parseSessionId('sess-1').ok).toBe(true);
    expect(parseChannelId('chan-1').ok).toBe(true);
    for (const parser of [
      parseMessageId,
      parseCorrelationId,
      parseEventId,
      parseIdempotencyKey,
      parseSessionId,
      parseChannelId,
    ])
      expect(parser('segment/other').ok).toBe(false);
  });

  it('validates digests and extension identity formats', () => {
    expect(parseManifestDigest('a'.repeat(64)).ok).toBe(true);
    expect(parseManifestDigest('A'.repeat(64)).ok).toBe(false);
    expect(parseManifestDigest('a'.repeat(32)).ok).toBe(false);
    expect(parseExtensionId('call-analysis').ok).toBe(true);
    expect(parseExtensionVersion('1.0.0').ok).toBe(true);
    expect(parseExtensionVersion('').ok).toBe(false);
    expect(parsePolicyVersion('2026.07').ok).toBe(true);
    expect(parseProviderReference('provider/ref-1').ok).toBe(true);
    expect(parseProviderReference('provider//ref-1').ok).toBe(false);
    expect(parseProviderReference('provider/../ref-1').ok).toBe(false);
  });

  it('validates memory and scheduler identities with traversal-safe grammars', () => {
    expect(parseMemoryRecordId('record-1').ok).toBe(true);
    expect(parseMemoryRecordId('../record').ok).toBe(false);
    expect(parseMemoryRecordId('record%2fescape').ok).toBe(false);
    expect(parseJobId('job-1').ok).toBe(true);
    expect(parseReminderId('reminder-1').ok).toBe(true);
    expect(parseScheduledJobId('scheduled-1').ok).toBe(true);
    expect(parseJobId(' x').ok).toBe(false);
    expect(parseReminderId('a\nb').ok).toBe(false);
    expect(parseScheduledJobId('x'.repeat(200)).ok).toBe(false);

    expect(parseResourceRef('memory/personal/record-1').ok).toBe(true);
    expect(parseResourceRef('memory/personal/../record').ok).toBe(false);
    expect(parseResourceRef('memory\\personal\\record-1').ok).toBe(false);
    expect(parseResourceRef('memory/personal/%2e%2e').ok).toBe(false);
    expect(parseResourceRef('file/personal/record-1').ok).toBe(false);
  });

  it('accepts only real canonical UTC ISO instants', () => {
    expect(parseISO8601('2024-02-29T12:30:45.000Z').ok).toBe(true);
    expect(parseISO8601('2023-02-29T12:30:45.000Z').ok).toBe(false);
    expect(parseISO8601('2026-07-28T12:30:45Z').ok).toBe(false);
    expect(parseISO8601('2026-07-28T12:30:45.000+00:00').ok).toBe(false);
    expect(parseISO8601('2026-07-28T12:30:45.000').ok).toBe(false);
    expect(parseISO8601('2026-13-01T00:00:00.000Z').ok).toBe(false);
  });

  it('exports safe parsers from the root API without unsafe brand assertions', () => {
    expect(typeof publicApi.parseMessageId).toBe('function');
    expect(typeof publicApi.parseCorrelationId).toBe('function');
    expect(typeof publicApi.parseManifestDigest).toBe('function');
    expect(typeof publicApi.parseMemoryRecordId).toBe('function');
    expect(typeof publicApi.parseResourceRef).toBe('function');
    expect(typeof publicApi.parseISO8601).toBe('function');
    expect(Object.keys(publicApi)).not.toContain('asMessageId');
    expect(Object.keys(publicApi)).not.toContain('brand');
  });
});
