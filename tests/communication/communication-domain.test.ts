import {
  parseCommunicationBindingVersion,
  parseConversationId,
  parseExternalTransportConversationReference,
  parseExternalTransportMessageReference,
  parseTransportInstanceId,
  parseTurnId,
  deriveCommunicationIdempotencyKey,
  normalizeAndValidateCommunicationText,
  computeCommunicationTextDigest,
  MAX_OWNER_TEXT_UTF8_BYTES,
  parseTransportTextObservation,
} from '../../src/core/communication/domain/index.js';
import { describe, expect, it } from 'vitest';

describe('communication identity parsers', () => {
  it('rejects whitespace without trimming', () => {
    const parsed = parseTurnId(' turn-1');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.code).toBe('WHITESPACE');
  });

  it('preserves case without case-folding trusted ids', () => {
    const lower = parseTurnId('turn-a');
    const upper = parseTurnId('TURN-A');
    expect(lower.ok).toBe(true);
    expect(upper.ok).toBe(true);
    if (!lower.ok || !upper.ok) return;
    expect(lower.value).not.toBe(upper.value);
  });

  it('canonicalizes CRLF line endings without trimming owner text', () => {
    const validated = normalizeAndValidateCommunicationText(
      '  hello\r\nworld  ',
      MAX_OWNER_TEXT_UTF8_BYTES,
      'Owner text',
    );
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    expect(validated.value).toBe('  hello\nworld  ');
  });

  it('rejects control characters other than tab and LF', () => {
    const validated = normalizeAndValidateCommunicationText(
      'hello\u0007',
      MAX_OWNER_TEXT_UTF8_BYTES,
      'Owner text',
    );
    expect(validated.ok).toBe(false);
    if (validated.ok) return;
    expect(validated.error.code).toBe('CONTROL_CHAR');
  });
});

describe('transport text observation exactness', () => {
  const baseObservation = {
    transportInstanceReference: 'tg-instance-1',
    externalMessageReference: 'msg-1',
    externalConversationReference: 'chat-1',
    externalSenderReference: 'sender-1',
    sourceTimestamp: null,
    text: 'hello',
  };

  it('accepts the exact observation shape', () => {
    const parsed = parseTransportTextObservation(baseObservation);
    expect(parsed.ok).toBe(true);
  });

  it('rejects extra fields', () => {
    const parsed = parseTransportTextObservation({ ...baseObservation, ownerId: 'owner-1' });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.code).toBe('FORBIDDEN_FIELD');
  });

  it('rejects missing fields', () => {
    const incomplete = {
      transportInstanceReference: baseObservation.transportInstanceReference,
      externalMessageReference: baseObservation.externalMessageReference,
      externalConversationReference: baseObservation.externalConversationReference,
      externalSenderReference: baseObservation.externalSenderReference,
      sourceTimestamp: baseObservation.sourceTimestamp,
    };
    const parsed = parseTransportTextObservation(incomplete);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.code).toBe('MALFORMED');
  });
});

describe('communication idempotency derivation', () => {
  const bindingInputs = () => {
    const transportInstanceId = parseTransportInstanceId('transport-1');
    const externalConversationReference = parseExternalTransportConversationReference('chat-1');
    const externalMessageReference = parseExternalTransportMessageReference('msg-1');
    const bindingVersion = parseCommunicationBindingVersion('binding-v1');
    if (
      !transportInstanceId.ok ||
      !externalConversationReference.ok ||
      !externalMessageReference.ok ||
      !bindingVersion.ok
    ) {
      throw new Error('fixture ids must parse');
    }
    return {
      transportInstanceId: transportInstanceId.value,
      externalConversationReference: externalConversationReference.value,
      externalMessageReference: externalMessageReference.value,
      bindingVersion: bindingVersion.value,
    };
  };

  it('is deterministic for identical admission inputs', () => {
    const inputs = bindingInputs();
    const first = deriveCommunicationIdempotencyKey(inputs);
    const second = deriveCommunicationIdempotencyKey(inputs);
    expect(first).toBe(second);
  });

  it('excludes sourceTimestamp from the idempotency preimage', () => {
    const inputs = bindingInputs();
    const withTimestampA = deriveCommunicationIdempotencyKey(inputs);
    const withTimestampB = deriveCommunicationIdempotencyKey({
      ...inputs,
      externalMessageReference: inputs.externalMessageReference,
    });
    expect(withTimestampA).toBe(withTimestampB);
    const observationA = parseTransportTextObservation({
      transportInstanceReference: 'transport-1',
      externalMessageReference: 'msg-1',
      externalConversationReference: 'chat-1',
      externalSenderReference: 'sender-1',
      sourceTimestamp: '2026-01-01T00:00:00Z',
      text: 'alpha',
    });
    const observationB = parseTransportTextObservation({
      transportInstanceReference: 'transport-1',
      externalMessageReference: 'msg-1',
      externalConversationReference: 'chat-1',
      externalSenderReference: 'sender-1',
      sourceTimestamp: '2026-02-02T00:00:00Z',
      text: 'beta',
    });
    expect(observationA.ok).toBe(true);
    expect(observationB.ok).toBe(true);
    expect(withTimestampA).toBe(withTimestampB);
  });

  it('changes when external message reference changes', () => {
    const inputs = bindingInputs();
    const first = deriveCommunicationIdempotencyKey(inputs);
    const altMessage = parseExternalTransportMessageReference('msg-2');
    if (!altMessage.ok) throw new Error('fixture message id must parse');
    const second = deriveCommunicationIdempotencyKey({
      ...inputs,
      externalMessageReference: altMessage.value,
    });
    expect(first).not.toBe(second);
  });
});

describe('communication text digest', () => {
  it('hashes canonicalized text bytes', () => {
    const text = normalizeAndValidateCommunicationText('a\r\nb', MAX_OWNER_TEXT_UTF8_BYTES);
    if (!text.ok) throw new Error('text must validate');
    const digest = computeCommunicationTextDigest(text.value);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('trusted id bounds', () => {
  it('parses conversation and turn ids within bounds', () => {
    expect(parseConversationId('conv-1').ok).toBe(true);
    expect(parseTurnId('turn-1').ok).toBe(true);
    expect(parseConversationId('').ok).toBe(false);
    expect(parseTurnId('x'.repeat(129)).ok).toBe(false);
  });
});
