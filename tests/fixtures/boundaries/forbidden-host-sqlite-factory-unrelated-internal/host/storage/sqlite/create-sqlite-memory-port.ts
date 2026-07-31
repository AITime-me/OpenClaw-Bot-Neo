import { sealSanitizedText } from '../../../core/domain/sanitized.internal.js';

export const createSqliteMemoryPort = (): unknown => sealSanitizedText;
