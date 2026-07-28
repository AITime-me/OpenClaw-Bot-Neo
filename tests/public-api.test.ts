import { describe, expect, it } from 'vitest';
import * as publicApi from '../src/index.js';

const exportedNames = Object.keys(publicApi);

describe('public API surface', () => {
  it('exposes the memory-write boundary and the digest helper', () => {
    expect(exportedNames).toContain('executeMemoryWrite');
    expect(exportedNames).toContain('computePayloadDigest');
  });

  it('never exposes a sealing factory, scanner internals or a raw pattern', () => {
    for (const forbidden of [
      'sealSanitizedText',
      'sealSanitizedMetadata',
      'sealVerifiedMemoryWrite',
      'sealValidatedApproval',
      'sanitizedTextBrand',
      'sanitizedMetadataBrand',
      'verifiedMemoryWriteBrand',
      'validatedApprovalBrand',
      'scanSensitiveData',
      'scanSensitiveMetadata',
      'maskSecrets',
      'analyzeBoundaries',
    ])
      expect(exportedNames).not.toContain(forbidden);
  });

  it('exports no regular expressions and no mutable objects', () => {
    for (const name of exportedNames) {
      const value: unknown = (publicApi as Record<string, unknown>)[name];
      expect(value instanceof RegExp).toBe(false);
      if (Array.isArray(value)) expect(Object.isFrozen(value)).toBe(true);
    }
  });
});
