import { describe, expect, it } from 'vitest';
import {
  assembleTextPrompt,
  FIXED_NEO_PERSONA_BODY,
  FIXED_SECURITY_SYSTEM_BODY,
} from '../../src/core/communication/policy/text-prompt-policy.js';
import { TEXT_PROMPT_SECTION_KINDS } from '../../src/core/communication/domain/index.js';
import { parseConversationId } from '../../src/core/communication/domain/index.js';
import { parseOwnerId, parsePolicyVersion } from '../../src/core/domain/index.js';
import {
  fakeSensitiveDataScanner,
  sampleSensitiveFinding,
  unavailableSensitiveDataScanner,
} from './support/fake-scanner.js';
import { asOwner, operationContext } from '../support/fixtures.js';

describe('text prompt policy', () => {
  const baseInput = () => {
    const ownerId = parseOwnerId(asOwner());
    const conversationId = parseConversationId('conv-1');
    const policyVersion = parsePolicyVersion('policy-v1');
    if (!ownerId.ok || !conversationId.ok || !policyVersion.ok) {
      throw new Error('fixture ids must parse');
    }
    return {
      ownerId: ownerId.value,
      conversationId: conversationId.value,
      policyVersion: policyVersion.value,
      securitySystemBody: FIXED_SECURITY_SYSTEM_BODY,
      neoPersonaBody: FIXED_NEO_PERSONA_BODY,
      memoryExcerpts: [],
      activeConversationContext: [],
      ownerText: 'What is on my schedule?',
      modelDerivedSummary: null,
    };
  };

  it('assembles exactly five sections when scanner allows with empty findings', async () => {
    const result = await assembleTextPrompt(
      baseInput(),
      fakeSensitiveDataScanner('allow'),
      operationContext(),
    );
    expect(result.kind).toBe('assembled');
    if (result.kind !== 'assembled') return;
    expect(result.prompt.sections.map((section) => section.kind)).toEqual([
      ...TEXT_PROMPT_SECTION_KINDS,
    ]);
  });

  it('rejects tampered fixed security or persona bodies', async () => {
    const result = await assembleTextPrompt(
      { ...baseInput(), securitySystemBody: 'tampered' },
      fakeSensitiveDataScanner('allow'),
      operationContext(),
    );
    expect(result.kind).toBe('invalid-input');
  });

  it('rejects prompt assembly when scanner denies section content', async () => {
    const result = await assembleTextPrompt(
      baseInput(),
      fakeSensitiveDataScanner('deny'),
      operationContext(),
    );
    expect(result.kind).toBe('rejected');
  });

  it('rejects prompt assembly when scanner returns redact', async () => {
    const result = await assembleTextPrompt(
      baseInput(),
      fakeSensitiveDataScanner('redact', 'redacted-text', [sampleSensitiveFinding()]),
      operationContext(),
    );
    expect(result.kind).toBe('rejected');
  });

  it('rejects prompt assembly when scanner allows but findings are present', async () => {
    const result = await assembleTextPrompt(
      baseInput(),
      fakeSensitiveDataScanner('allow', 'unused', [sampleSensitiveFinding()]),
      operationContext(),
    );
    expect(result.kind).toBe('rejected');
  });

  it('fails closed when the scanner is unavailable', async () => {
    const result = await assembleTextPrompt(
      baseInput(),
      unavailableSensitiveDataScanner(),
      operationContext(),
    );
    expect(result.kind).toBe('scanner-unavailable');
  });
});
