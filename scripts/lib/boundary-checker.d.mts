export interface BoundaryViolation {
  readonly code: string;
  readonly message: string;
}
export interface BoundaryReport {
  readonly filesAnalyzed: number;
  readonly violations: readonly BoundaryViolation[];
}
export interface ModuleReference {
  readonly specifier: string;
  readonly kind: string;
  readonly line: number;
  readonly computed?: boolean;
}
export interface PersistenceFacadeExportManifest {
  readonly allowedExports: readonly string[];
  readonly allowedImporters: readonly string[];
}
export interface ExportedNamesReport {
  readonly names: readonly string[];
  readonly hasExportStar: boolean;
  readonly hasReexport: boolean;
}
export interface AnalyzeBoundariesOptions {
  readonly rootDir?: string;
  readonly layerRules?: Readonly<Record<string, readonly string[]>>;
  readonly requiredLayers?: readonly string[];
  readonly internalAllowlist?: Readonly<Record<string, readonly string[]>>;
  readonly facadeExportManifests?: Readonly<Record<string, PersistenceFacadeExportManifest>>;
}
export declare const CORE_LAYER_RULES: Readonly<Record<string, readonly string[]>>;
export declare const REQUIRED_CORE_LAYERS: readonly string[];
export declare const INTERNAL_MODULE_ALLOWLIST: Readonly<Record<string, readonly string[]>>;
export declare const COMMUNICATION_PERSISTENCE_FACADE_EXPORT_MANIFESTS: Readonly<
  Record<string, PersistenceFacadeExportManifest>
>;
export declare const POSIX_DURABLE_COMPOSITION_FACTORY_PATH: string;
export declare const POSIX_DURABLE_COMPOSITION_DYNAMIC_IMPORT_TARGETS: ReadonlyArray<string>;
export declare function toPosix(value: string): string;
export declare function extractReferences(
  sourceText: string,
  fileName: string,
): readonly ModuleReference[];
export declare function extractExportedNames(
  sourceText: string,
  fileName: string,
): ExportedNamesReport;
export declare function analyzeBoundaries(options?: AnalyzeBoundariesOptions): BoundaryReport;
