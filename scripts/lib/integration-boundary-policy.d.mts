export declare function toPosixPath(value: string): string;

export declare function normalizeSpecifier(
  specifier: string,
): { ok: true; value: string } | { ok: false; reason: string };

export declare function isForbiddenTarget(normalizedPath: string): boolean;

export declare function resolveRepoRelativeImport(
  importerRelPath: string,
  specifier: string,
  rootDir: string,
): string;

export declare function stripImportTypeBlocks(content: string): string;

export declare function extractImportSpecifiers(
  content: string,
): ReadonlyArray<{ kind: string; value: string }>;

export declare function hasRuntimeFactoryImport(content: string): boolean;

export declare function evaluateImport(
  importerRelPath: string,
  specifierEntry: { kind: string; value: string },
  rootDir: string,
): readonly string[];

export declare function analyzeFileContent(
  importerRelPath: string,
  content: string,
  rootDir: string,
): readonly string[];

export declare function collectTsFiles(directory: string): readonly string[];

export declare const HARNESS_MJS_ALLOWLIST: readonly string[];

export declare function analyzeHarnessMjsContent(
  importerRelPath: string,
  content: string,
  rootDir: string,
): readonly string[];

export declare function analyzeIntegrationBoundaries(options: {
  rootDir: string;
  filesContent?: Readonly<Record<string, string>>;
}): readonly string[];
