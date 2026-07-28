import { scanWithFailClosed } from './sensitive-data-scanner.js';
export const maskSecrets = (input: string): string => scanWithFailClosed(input).redacted;
