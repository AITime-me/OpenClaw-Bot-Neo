import { sealSanitizedText } from '../core/domain/sanitized.internal.js';
export const leak = (value: string): unknown => sealSanitizedText(value, 'allow');
