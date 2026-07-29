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
  | 'github-token'
  | 'aws-access-key'
  | 'aws-secret-key'
  | 'google-api-key'
  | 'jwt'
  | 'oauth-client-secret'
  | 'webhook-signing-secret'
  | 'unknown-sensitive-pattern';
export type SensitiveSeverity = 'medium' | 'high' | 'critical';
/**
 * A finding never carries fragments of the detected secret. `maskedPreview` is a
 * category-derived constant and `location` identifies a metadata path, not a value.
 */
export interface SensitiveFinding {
  readonly category: SensitiveCategory;
  readonly start: number;
  readonly end: number;
  readonly maskedPreview: string;
  readonly severity: SensitiveSeverity;
  readonly location: string;
}
export type ScanDecision = 'allow' | 'redact' | 'deny';
export type SafeScanDecision = 'allow' | 'redact';
export interface ScanReport {
  readonly decision: ScanDecision;
  readonly findings: readonly SensitiveFinding[];
  readonly redacted: string;
}
export interface MetadataScanReport {
  readonly decision: ScanDecision;
  readonly findings: readonly SensitiveFinding[];
  readonly redactedEntries: Readonly<Record<string, string>>;
}
