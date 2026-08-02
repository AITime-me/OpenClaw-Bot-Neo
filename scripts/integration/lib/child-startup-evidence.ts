/**
 * Serialize allowlisted child startup failure diagnostics for scenario evidence.
 */
import { safeSerializeForEvidence } from './redaction.ts';
import type { ChildStartupDiagnostics } from './child-stderr.ts';

export const serializeChildStartupFailureDetail = (diagnostics: ChildStartupDiagnostics): string =>
  safeSerializeForEvidence({
    diagnosticClass: diagnostics.diagnosticClass,
    exitCode: diagnostics.exitCode,
    protocolEventCount: diagnostics.protocolEventCount,
    stderrTruncated: diagnostics.stderrTruncated,
    stderrSummary: diagnostics.stderrSummary,
  });
