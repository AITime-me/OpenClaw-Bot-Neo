import type {
  DomainError,
  MetadataScanReport,
  OperationContext,
  Result,
  ScanReport,
} from '../domain/index.js';
export interface SensitiveDataScannerPort {
  scanText(input: string, context: OperationContext): Promise<Result<ScanReport, DomainError>>;
  scanMetadata(
    input: Readonly<Record<string, unknown>>,
    context: OperationContext,
  ): Promise<Result<MetadataScanReport, DomainError>>;
}
