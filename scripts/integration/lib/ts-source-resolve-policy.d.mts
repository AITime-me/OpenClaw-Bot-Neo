export declare function isPathInsideRoot(candidate: string, root: string): boolean;

export declare function isRelativeJsSpecifier(specifier: string): boolean;

export declare function parentFilePathFromURL(parentURL: unknown): string | null;

export declare function tryResolveTsSourceFallback(input: {
  readonly specifier: string;
  readonly parentURL: string | URL | undefined;
  readonly srcRoot: string;
}): { ok: true; url: string } | { ok: false };
