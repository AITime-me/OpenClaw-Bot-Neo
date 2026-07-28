import type { ExtensionManifest } from './extension-manifest.js';

export const verifiedExtensionManifestBrand: unique symbol = Symbol('VerifiedExtensionManifest');

export interface VerifiedExtensionManifest extends ExtensionManifest {
  readonly [verifiedExtensionManifestBrand]: true;
}

const freezeRecord = (value: unknown): void => {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return;
  for (const nested of Object.values(value)) freezeRecord(nested);
  Object.freeze(value);
};

/** Internal sealing factory; architecture rules restrict its importer to the validator. */
export const sealVerifiedExtensionManifest = (
  manifest: ExtensionManifest,
): VerifiedExtensionManifest => {
  const sealed = {
    ...manifest,
    declaredCapabilities: [...manifest.declaredCapabilities],
    requiredPorts: [...manifest.requiredPorts],
    requestedPermissions: [...manifest.requestedPermissions],
    dataClassifications: [...manifest.dataClassifications],
    supportedInputKinds: [...manifest.supportedInputKinds],
    supportedOutputKinds: [...manifest.supportedOutputKinds],
    approvalPolicy: { ...manifest.approvalPolicy, effects: [...manifest.approvalPolicy.effects] },
    provenance: { ...manifest.provenance },
    ownerScope: { ...manifest.ownerScope },
    [verifiedExtensionManifestBrand]: true as const,
  };
  freezeRecord(sealed);
  return sealed;
};
