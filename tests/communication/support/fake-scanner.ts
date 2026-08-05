import { ok, err } from '../../../src/core/domain/index.js';
import type {
  DomainError,
  MetadataScanReport,
  OperationContext,
  Result,
  ScanReport,
} from '../../../src/core/domain/index.js';
import type { SensitiveDataScannerPort } from '../../../src/core/ports/sensitive-data-scanner.port.js';

export const fakeSensitiveDataScanner = (
  decision: ScanReport['decision'] = 'allow',
  redacted = 'redacted-text',
): SensitiveDataScannerPort => ({
  scanText(input: string, context: OperationContext): Promise<Result<ScanReport, DomainError>> {
    void context;
    return Promise.resolve(
      ok({
        decision,
        findings: [],
        redacted: decision === 'redact' ? redacted : input,
      }),
    );
  },
  scanMetadata(
    input: Readonly<Record<string, unknown>>,
    context: OperationContext,
  ): Promise<Result<MetadataScanReport, DomainError>> {
    void input;
    void context;
    return Promise.resolve(
      ok({
        decision: 'allow',
        findings: [],
        redactedEntries: {},
      }),
    );
  },
});

export const unavailableSensitiveDataScanner = (): SensitiveDataScannerPort => ({
  scanText(input: string, context: OperationContext): Promise<Result<ScanReport, DomainError>> {
    void input;
    void context;
    return Promise.resolve(
      err({ code: 'CAPABILITY_UNAVAILABLE', capability: 'sensitive-data-scanner' }),
    );
  },
  scanMetadata(
    input: Readonly<Record<string, unknown>>,
    context: OperationContext,
  ): Promise<Result<MetadataScanReport, DomainError>> {
    void input;
    void context;
    return Promise.resolve(
      err({ code: 'CAPABILITY_UNAVAILABLE', capability: 'sensitive-data-scanner' }),
    );
  },
});
