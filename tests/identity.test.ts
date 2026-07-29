import { describe, expect, it } from 'vitest';
import {
  parseChannelId,
  parseCorrelationId,
  parseEventId,
  parseExtensionId,
  parseExtensionVersion,
  parseIdempotencyKey,
  parseManifestDigest,
  parseMessageId,
  parsePolicyVersion,
  parseProviderReference,
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
  });

  it('exports safe parsers from the root API without unsafe brand assertions', () => {
    expect(typeof publicApi.parseMessageId).toBe('function');
    expect(typeof publicApi.parseCorrelationId).toBe('function');
    expect(typeof publicApi.parseManifestDigest).toBe('function');
    expect(Object.keys(publicApi)).not.toContain('asMessageId');
    expect(Object.keys(publicApi)).not.toContain('brand');
  });
});
