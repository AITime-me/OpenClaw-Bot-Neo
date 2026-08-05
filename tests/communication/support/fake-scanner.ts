import { ok, err } from '../../../src/core/domain/index.js';
import type {
  DomainError,
  MetadataScanReport,
  OperationContext,
  Result,
  ScanReport,
  SensitiveFinding,
} from '../../../src/core/domain/index.js';
import type { SensitiveDataScannerPort } from '../../../src/core/ports/sensitive-data-scanner.port.js';

export const fakeSensitiveDataScanner = (
  decision: ScanReport['decision'] = 'allow',
  redacted = 'redacted-text',
  findings: readonly SensitiveFinding[] = [],
): SensitiveDataScannerPort => ({
  scanText(input: string, context: OperationContext): Promise<Result<ScanReport, DomainError>> {
    void context;
    return Promise.resolve(
      ok({
        decision,
        findings: [...findings],
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
        decision,
        findings: [...findings],
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

export const sampleSensitiveFinding = (): SensitiveFinding =>
  Object.freeze({
    category: 'api-key',
    start: 0,
    end: 8,
    maskedPreview: '[REDACTED:api-key]',
    severity: 'high',
    location: 'text',
  });
