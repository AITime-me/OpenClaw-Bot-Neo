import { describe, expect, it } from 'vitest';
import * as communicationDomain from '../../src/core/communication/domain/index.js';
import {
  isAuthenticatedCommunicationPrincipal,
  getCommunicationPrincipalRedactedMetadata,
} from '../../src/core/communication/domain/authenticated-communication-principal.internal.js';
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
import { asActor, asOwner, iso } from '../support/fixtures.js';

const principalInputs = () => {
  const turnId = parseTurnId('turn-1');
  const ownerId = parseOwnerId(asOwner());
  const actorId = parseActorId(asActor());
  const conversationId = parseConversationId('conv-1');
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
  const admissionEvidence = sealFreshObservedAdmissionEvidence(turnId.value);
  return {
    turnId: turnId.value,
    ownerId: ownerId.value,
    actorId: actorId.value,
    conversationId: conversationId.value,
    transportInstanceId: transportInstanceId.value,
    bindingVersion: bindingVersion.value,
    observedAt: observedAt.value,
    admissionEvidence,
  };
};

describe('AuthenticatedCommunicationPrincipal capability security', () => {
  it('issues a genuine principal only from fresh admission evidence', () => {
    const input = principalInputs();
    const issued = issueAuthenticatedCommunicationPrincipal(input);
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    expect(isAuthenticatedCommunicationPrincipal(issued.value)).toBe(true);
    expect(getCommunicationPrincipalRedactedMetadata(issued.value)?.bindingVersion).toBe(
      input.bindingVersion,
    );
  });

  it('rejects forged, spread, JSON, and structuredClone principals', () => {
    const input = principalInputs();
    const issued = issueAuthenticatedCommunicationPrincipal(input);
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    const legitimate = issued.value;
    expect(isAuthenticatedCommunicationPrincipal(legitimate)).toBe(true);
    expect(isAuthenticatedCommunicationPrincipal({ ...legitimate })).toBe(false);
    expect(isAuthenticatedCommunicationPrincipal(Object.assign({}, legitimate))).toBe(false);
    expect(() => JSON.stringify(legitimate)).toThrow(/not serializable/i);
    expect(isAuthenticatedCommunicationPrincipal(structuredClone(legitimate))).toBe(false);
    expect(isAuthenticatedCommunicationPrincipal(Object.freeze({}) as never)).toBe(false);
  });

  it('throws on JSON.stringify of a genuine principal', () => {
    const input = principalInputs();
    const issued = issueAuthenticatedCommunicationPrincipal(input);
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    expect(() => JSON.stringify(issued.value)).toThrow(/not serializable/i);
  });

  it('does not export principal issuer helpers from the domain barrel', () => {
    expect(Object.keys(communicationDomain)).not.toContain(
      'issueAuthenticatedCommunicationPrincipal',
    );
    expect(Object.keys(communicationDomain)).not.toContain('sealFreshObservedAdmissionEvidence');
    expect(Object.keys(communicationDomain)).not.toContain(
      'getAuthenticatedCommunicationPrincipalCanonical',
    );
  });

  it('consumes admission evidence exactly once', () => {
    const input = principalInputs();
    const first = issueAuthenticatedCommunicationPrincipal(input);
    const second = issueAuthenticatedCommunicationPrincipal(input);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe('ADMISSION_EVIDENCE_ALREADY_CONSUMED');
  });
});
