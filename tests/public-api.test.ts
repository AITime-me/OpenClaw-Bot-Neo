import { describe, expect, it } from 'vitest';
import * as publicApi from '../src/index.js';
import * as applicationApi from '../src/core/application/index.js';
import { createExtensionActivationGateway } from '../src/core/application/extension-activation.gateway.js';
import { createExtensionPermissionGateway } from '../src/core/application/extension-permission.gateway.js';

const exportedNames = Object.keys(publicApi);
const applicationNames = Object.keys(applicationApi);

describe('public API surface', () => {
  it('exposes the memory-write boundary and the digest helper', () => {
    expect(exportedNames).toContain('executeMemoryWrite');
    expect(exportedNames).toContain('createMemoryAccessGateway');
    expect(exportedNames).toContain('createExtensionPermissionGateway');
    expect(exportedNames).toContain('createExtensionActivationGateway');
    expect(exportedNames).toContain('createVoiceResolutionGateway');
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
      'issueDeploymentAuthorization',
      'issueDeploymentAuthorizationFromObservation',
      'classifyExtensionRuntimeRisk',
      'sealCurrentExtensionPolicySnapshot',
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
      'createLocalHost',
      'LOCAL_HOST_DIAGNOSTICS',
      'createExplicitAllowMemoryPolicy',
      'createDenyByDefaultMemoryPolicy',
      'createInMemoryMemoryStore',
      'seedLocalApprovalGrant',
      'parseLocalHostConfig',
      'createLocalHostFromConfig',
      'parseContractDraftExample',
      'parseExactDraft',
      'exactJsonDto',
      'exactPlainObservation',
      'snapshotPlainJsonDto',
      'snapshotRuntimeRiskOperationRequest',
      'canonicalWebhookSignedBytes',
      'copyExactBytes',
      'exactCommandDescriptors',
      'copyStringRecord',
      'validateNpmCliPath',
    ])
      expect(exportedNames).not.toContain(forbidden);
  });

  it('exposes trusted classification and validation services without sealers', () => {
    expect(exportedNames).toContain('createExtensionPermissionGateway');
    expect(exportedNames).toContain('createExtensionActivationGateway');
    expect(exportedNames).toContain('createVoiceResolutionGateway');
    expect(exportedNames).toContain('computeManifestDigest');
    expect(exportedNames).not.toContain('classifyExtensionRuntimeRisk');
    expect(exportedNames).not.toContain('issueDeploymentAuthorization');
    expect(exportedNames).not.toContain('issueDeploymentAuthorizationFromObservation');
  });

  it('keeps trusted issuers/classifier out of the application barrel', () => {
    expect(applicationNames).not.toContain('issueDeploymentAuthorizationFromObservation');
    expect(applicationNames).not.toContain('classifyExtensionRuntimeRisk');
    expect(applicationNames).not.toContain('snapshotRuntimeRiskOperationRequest');
    expect(applicationNames).not.toContain('canonicalWebhookSignedBytes');
    expect(applicationNames).toContain('createExtensionPermissionGateway');
    expect(applicationNames).toContain('createExtensionActivationGateway');
    expect(applicationNames).toContain('computeManifestDigest');
    expect(applicationNames).toContain('executeExtensionActivation');
    expect(typeof createExtensionPermissionGateway).toBe('function');
    expect(typeof createExtensionActivationGateway).toBe('function');
  });

  it('exports no regular expressions and no mutable objects', () => {
    for (const name of exportedNames) {
      const value: unknown = (publicApi as Record<string, unknown>)[name];
      expect(value instanceof RegExp).toBe(false);
      if (Array.isArray(value)) expect(Object.isFrozen(value)).toBe(true);
    }
  });

  it('keeps the app-private host composition out of the package root', () => {
    expect(exportedNames).not.toContain('createLocalHost');
    expect(exportedNames).not.toContain('LOCAL_HOST_DIAGNOSTICS');
    expect(exportedNames).not.toContain('createInMemoryMemoryStore');
    expect(exportedNames).not.toContain('createInMemoryApprovalStore');
    expect(exportedNames).not.toContain('createExplicitAllowMemoryPolicy');
    expect(exportedNames).not.toContain('seedLocalApprovalGrant');
    expect(exportedNames).not.toContain('parseLocalHostConfig');
    expect(exportedNames).not.toContain('createLocalHostFromConfig');
  });

  it('exports safe identity/config/node helpers without internals', () => {
    expect(exportedNames).toContain('parseMessageId');
    expect(exportedNames).toContain('parseCorrelationId');
    expect(exportedNames).toContain('parseMemoryRecordId');
    expect(exportedNames).toContain('parseResourceRef');
    expect(exportedNames).toContain('parseISO8601');
    expect(exportedNames).toContain('parseModelRoutingConfig');
    expect(exportedNames).toContain('parseAutomationQuotasDraft');
    expect(exportedNames).toContain('evaluateNodeSupport');
    expect(exportedNames).not.toContain('assertProductionNode');
    expect(exportedNames).not.toContain('snapshotPlainJsonDto');
    expect(exportedNames).not.toContain('exactPlainObservation');
  });
});
