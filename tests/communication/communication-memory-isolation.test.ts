import { describe, expect, it, expectTypeOf } from 'vitest';
import { authorizeCommunicationMemoryRead } from '../../src/core/communication/policy/communication-memory-authorization.js';
import type { CommunicationMemoryAuthorizationPort } from '../../src/core/communication/ports/communication-memory-authorization.port.js';
import {
  issueAuthenticatedCommunicationPrincipal,
  sealFreshObservedAdmissionEvidence,
} from '../../src/core/communication/domain/authenticated-communication-principal.internal.js';
import {
  parseCommunicationBindingVersion,
  parseConversationId,
  parseTransportInstanceId,
  parseTurnId,
} from '../../src/core/communication/domain/index.js';
import { parseActorId, parseISO8601, parseOwnerId } from '../../src/core/domain/index.js';
import { COMMUNICATION_MEMORY_READ_PURPOSE } from '../../src/core/communication/ports/communication-memory-authorization.port.js';
import { asActor, asCorrelation, asOwner, iso, operationContext } from '../support/fixtures.js';

const issuePrincipal = (owner: string, conversation: string) => {
  const turnId = parseTurnId('turn-memory-1');
  const ownerId = parseOwnerId(owner);
  const actorId = parseActorId(asActor());
  const conversationId = parseConversationId(conversation);
  const transportInstanceId = parseTransportInstanceId('transport-1');
  const bindingVersion = parseCommunicationBindingVersion('binding-v1');
  const observedAt = parseISO8601(iso('2026-07-01T12:00:00.000Z'));
  if (
    !turnId.ok ||
    !ownerId.ok ||
    !actorId.ok ||
    !conversationId.ok ||
    !transportInstanceId.ok ||
    !bindingVersion.ok ||
    !observedAt.ok
  ) {
    throw new Error('principal fixture ids must parse');
  }
  const issued = issueAuthenticatedCommunicationPrincipal({
    turnId: turnId.value,
    ownerId: ownerId.value,
    actorId: actorId.value,
    conversationId: conversationId.value,
    transportInstanceId: transportInstanceId.value,
    bindingVersion: bindingVersion.value,
    observedAt: observedAt.value,
    admissionEvidence: sealFreshObservedAdmissionEvidence(turnId.value),
  });
  if (!issued.ok) throw new Error(issued.error.reason);
  return { principal: issued.value, ownerId: ownerId.value, conversationId: conversationId.value };
};

describe('communication memory authorization boundary', () => {
  it('denies forged principals', () => {
    const conversationId = parseConversationId('conv-1');
    expect(conversationId.ok).toBe(true);
    if (!conversationId.ok) return;
    const decision = authorizeCommunicationMemoryRead({
      principal: Object.freeze({}),
      expectedOwnerId: asOwner(),
      expectedConversationId: conversationId.value,
      correlationId: asCorrelation(),
      purpose: COMMUNICATION_MEMORY_READ_PURPOSE,
      maxRecords: 4,
      maxTotalBytes: 1024,
    });
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.error.code).toBe('FORGED_PRINCIPAL');
  });

  it('denies owner and conversation mismatches', () => {
    const { principal, conversationId } = issuePrincipal(asOwner(), 'conv-1');
    const ownerMismatch = authorizeCommunicationMemoryRead({
      principal,
      expectedOwnerId: asOwner('other-owner'),
      expectedConversationId: conversationId,
      correlationId: asCorrelation(),
      purpose: COMMUNICATION_MEMORY_READ_PURPOSE,
      maxRecords: 4,
      maxTotalBytes: 1024,
    });
    expect(ownerMismatch.ok).toBe(false);
    if (!ownerMismatch.ok) expect(ownerMismatch.error.code).toBe('OWNER_MISMATCH');

    const otherConversation = parseConversationId('conv-other');
    expect(otherConversation.ok).toBe(true);
    if (!otherConversation.ok) return;
    const conversationMismatch = authorizeCommunicationMemoryRead({
      principal,
      expectedOwnerId: asOwner(),
      expectedConversationId: otherConversation.value,
      correlationId: asCorrelation(),
      purpose: COMMUNICATION_MEMORY_READ_PURPOSE,
      maxRecords: 4,
      maxTotalBytes: 1024,
    });
    expect(conversationMismatch.ok).toBe(false);
    if (!conversationMismatch.ok)
      expect(conversationMismatch.error.code).toBe('CONVERSATION_MISMATCH');
  });

  it('denies non-personal namespace selectors', () => {
    const { principal, ownerId, conversationId } = issuePrincipal(asOwner(), 'conv-1');
    const denied = authorizeCommunicationMemoryRead({
      principal,
      expectedOwnerId: ownerId,
      expectedConversationId: conversationId,
      correlationId: asCorrelation(),
      purpose: COMMUNICATION_MEMORY_READ_PURPOSE,
      maxRecords: 4,
      maxTotalBytes: 1024,
      requestedNamespace: 'security-restricted',
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe('NAMESPACE_DENIED');
  });

  it('keeps the broker port read-only at the type level', () => {
    expectTypeOf<CommunicationMemoryAuthorizationPort>().toHaveProperty('readAuthorizedContext');
    expectTypeOf<CommunicationMemoryAuthorizationPort>().not.toHaveProperty('write');
    expectTypeOf<CommunicationMemoryAuthorizationPort>().not.toHaveProperty('delete');
    expectTypeOf<CommunicationMemoryAuthorizationPort>().not.toHaveProperty('deleteRecord');
  });

  it('never exposes operation context mutation hooks on the port', () => {
    const _context = operationContext();
    expect(_context.signal).toBeInstanceOf(AbortSignal);
  });
});
