import type { ExtensionManifest } from './extension-manifest.js';
import { deepFreeze } from './immutable.js';

export type VerifiedExtensionManifest = ExtensionManifest;

const verifiedManifestRegistry = new WeakMap<object, ExtensionManifest>();

/** Internal sealing factory; architecture rules restrict its importer to the validator. */
export const sealVerifiedExtensionManifest = (
  manifest: ExtensionManifest,
): VerifiedExtensionManifest => {
  const sealed = deepFreeze({
    ...manifest,
    declaredCapabilities: Object.freeze([...manifest.declaredCapabilities]),
    requiredPorts: Object.freeze([...manifest.requiredPorts]),
    requestedPermissions: Object.freeze([...manifest.requestedPermissions]),
    dataClassifications: Object.freeze([...manifest.dataClassifications]),
    supportedInputKinds: Object.freeze([...manifest.supportedInputKinds]),
    supportedOutputKinds: Object.freeze([...manifest.supportedOutputKinds]),
    approvalPolicy: deepFreeze({
      ...manifest.approvalPolicy,
      effects: Object.freeze([...manifest.approvalPolicy.effects]),
    }),
    provenance: deepFreeze({ ...manifest.provenance }),
    ownerScope: deepFreeze({ ...manifest.ownerScope }),
  });
  verifiedManifestRegistry.set(sealed, sealed);
  return sealed;
};

export const isVerifiedExtensionManifest = (value: unknown): value is VerifiedExtensionManifest =>
  typeof value === 'object' && value !== null && verifiedManifestRegistry.has(value);
