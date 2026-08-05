import { describe, expect, it } from 'vitest';
import {
  createDeterministicNotice,
  DETERMINISTIC_NOTICE_TEXT,
  validateTextOutput,
} from '../../src/core/communication/policy/text-output-policy.js';
import { isValidatedTextOutput } from '../../src/core/communication/domain/index.js';
import {
  fakeSensitiveDataScanner,
  unavailableSensitiveDataScanner,
} from './support/fake-scanner.js';
import { operationContext } from '../support/fixtures.js';

describe('text output policy', () => {
  it('seals validated LLM output when the scanner allows text', async () => {
    const result = await validateTextOutput(
      { source: 'llm', text: 'hello owner' },
      fakeSensitiveDataScanner('allow'),
      operationContext(),
    );
    expect(result.kind).toBe('validated');
    if (result.kind !== 'validated') return;
    expect(isValidatedTextOutput(result.output)).toBe(true);
  });

  it('rejects output when the scanner denies text', async () => {
    const result = await validateTextOutput(
      { source: 'llm', text: 'secret-token' },
      fakeSensitiveDataScanner('deny'),
      operationContext(),
    );
    expect(result.kind).toBe('rejected');
  });

  it('fails closed when the scanner is unavailable', async () => {
    const result = await validateTextOutput(
      { source: 'llm', text: 'hello' },
      unavailableSensitiveDataScanner(),
      operationContext(),
    );
    expect(result.kind).toBe('scanner-unavailable');
  });

  it('creates deterministic notices only for known failure reasons', async () => {
    const notice = await createDeterministicNotice(
      'provider-unavailable',
      fakeSensitiveDataScanner('allow'),
      operationContext(),
    );
    expect(notice.kind).toBe('notice');
    if (notice.kind !== 'notice') return;
    expect(isValidatedTextOutput(notice.output)).toBe(true);
    expect(DETERMINISTIC_NOTICE_TEXT).toContain('unable to complete');
  });

  it('forbids deterministic notices for unknown reasons', async () => {
    const notice = await createDeterministicNotice(
      'outcome-unknown' as never,
      fakeSensitiveDataScanner('allow'),
      operationContext(),
    );
    expect(notice.kind).toBe('forbidden');
  });
});
