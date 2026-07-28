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
}
export interface AnalyzeBoundariesOptions {
  readonly rootDir?: string;
  readonly layerRules?: Readonly<Record<string, readonly string[]>>;
  readonly requiredLayers?: readonly string[];
  readonly internalAllowlist?: Readonly<Record<string, readonly string[]>>;
}
export declare const CORE_LAYER_RULES: Readonly<Record<string, readonly string[]>>;
export declare const REQUIRED_CORE_LAYERS: readonly string[];
export declare const INTERNAL_MODULE_ALLOWLIST: Readonly<Record<string, readonly string[]>>;
export declare function extractReferences(
  sourceText: string,
  fileName: string,
): readonly ModuleReference[];
export declare function analyzeBoundaries(options?: AnalyzeBoundariesOptions): BoundaryReport;
