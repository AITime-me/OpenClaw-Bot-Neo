import { describe, expect, it } from 'vitest';
import * as publicApi from '../src/index.js';

const exportedNames = Object.keys(publicApi);

describe('public API surface', () => {
  it('exposes the memory-write boundary and the digest helper', () => {
    expect(exportedNames).toContain('executeMemoryWrite');
    expect(exportedNames).toContain('createMemoryAccessGateway');
    expect(exportedNames).toContain('computePayloadDigest');
    expect(exportedNames).toContain('executeExtensionRegistration');
    expect(exportedNames).toContain('executeExtensionActivation');
    expect(exportedNames).toContain('executeWebhookIngress');
    expect(exportedNames).toContain('resolveExtensionPermissions');
    expect(exportedNames).toContain('authorizeWebhookIngress');
    expect(exportedNames).toContain('validateVoiceProfile');
  });

  it('never exposes a sealing factory, scanner internals or a raw pattern', () => {
    for (const forbidden of [
      'sealSanitizedText',
      'sealSanitizedMetadata',
      'sealVerifiedMemoryWrite',
      'sealValidatedApproval',
      'sealAuthenticatedMemoryAccess',
      'sanitizedTextBrand',
      'sanitizedMetadataBrand',
      'verifiedMemoryWriteBrand',
      'validatedApprovalBrand',
      'scanSensitiveData',
      'scanSensitiveMetadata',
      'maskSecrets',
      'analyzeBoundaries',
      'sealVerifiedExtensionManifest',
      'verifiedExtensionManifestBrand',
      'sealValidatedVoiceProfile',
      'validatedVoiceProfileBrand',
      'validateExtensionManifest',
      'loadExtension',
      'discoverExtensions',
      'deriveMemoryWriteApprovalDemand',
      'readTrustedTimestamp',
      'memoryWriteTarget',
      'sealValidatedApproval',
      'fixedClock',
      'analyzeExecuteMemoryWrite',
      'collectDirectCalls',
      'sealExtensionRegistryEntry',
      'sealActiveExtensionRegistration',
      'sealTrustedActivationDecision',
      'sealAuthorizedWebhookIngress',
      'sealRawWebhookPayloadHandle',
      'sealPayloadBoundSignature',
      'computeWebhookPayloadDigest',
      'sealRuntimeRiskEvidence',
      'runtimeRiskEvidenceBrand',
      'sealDeploymentAuthorization',
      'deploymentAuthorizationBrand',
      'toActiveExtensionRegistration',
      'activeExtensionRegistrationBrand',
      'sealVerifiedVoiceProviderMatch',
      'verifiedVoiceProviderMatchBrand',
      'authenticatedRegistry',
      'createHarness',
      'accessContext',
    ])
      expect(exportedNames).not.toContain(forbidden);
  });

  it('exposes trusted classification and validation services without sealers', () => {
    expect(exportedNames).toContain('classifyExtensionRuntimeRisk');
    expect(exportedNames).toContain('issueDeploymentAuthorization');
    expect(exportedNames).toContain('validateVoiceProviderMatch');
    expect(exportedNames).toContain('computeManifestDigest');
  });

  it('exports no regular expressions and no mutable objects', () => {
    for (const name of exportedNames) {
      const value: unknown = (publicApi as Record<string, unknown>)[name];
      expect(value instanceof RegExp).toBe(false);
      if (Array.isArray(value)) expect(Object.isFrozen(value)).toBe(true);
    }
  });
});
