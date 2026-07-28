import type { DomainError, Result } from '../domain/index.js';
import type { OperationContext } from './operation-context.js';
export type SensitiveCategory =
  | 'api-key'
  | 'bearer-token'
  | 'telegram-bot-token'
  | 'password'
  | 'cookie'
  | 'private-key'
  | 'recovery-code'
  | 'url-credentials'
  | 'connection-string'
  | 'unknown-sensitive-pattern';
export interface SensitiveFinding {
  readonly category: SensitiveCategory;
  readonly start: number;
  readonly end: number;
  readonly maskedPreview: string;
  readonly severity: 'medium' | 'high' | 'critical';
}
export type ScanDecision = 'allow' | 'redact' | 'deny';
export interface ScanReport {
  readonly decision: ScanDecision;
  readonly findings: readonly SensitiveFinding[];
  readonly redacted: string;
}
export interface SensitiveDataScannerPort {
  scanText(input: string, context: OperationContext): Promise<Result<ScanReport, DomainError>>;
  scanMetadata(
    input: Readonly<Record<string, unknown>>,
    context: OperationContext,
  ): Promise<Result<ScanReport, DomainError>>;
}
