export interface MemoryIsolationReport {
  readonly ok: boolean;
  readonly failures: readonly string[];
  readonly calls?: readonly {
    readonly name: string;
    readonly position: number;
    readonly line: number;
  }[];
}

export declare function collectDirectCalls(
  source: unknown,
  functionNode: unknown,
): readonly { readonly name: string; readonly position: number; readonly line: number }[] | null;

export declare function analyzeExecuteMemoryWrite(
  sourceText: string,
  fileName?: string,
): MemoryIsolationReport;
