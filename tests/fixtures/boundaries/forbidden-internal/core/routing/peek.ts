import { sealSanitizedText } from '../domain/sanitized.internal.js';
export const peek = (value: string): unknown => sealSanitizedText(value, 'allow');
