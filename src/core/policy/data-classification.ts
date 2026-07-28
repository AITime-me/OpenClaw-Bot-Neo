import type { PrivacyClassification } from '../domain/index.js';
export function classifyData(
  source: 'public' | 'owner' | 'business' | 'security',
): PrivacyClassification {
  return source === 'public'
    ? 'public'
    : source === 'owner'
      ? 'confidential'
      : source === 'business'
        ? 'commercial-secret'
        : 'security-restricted';
}
