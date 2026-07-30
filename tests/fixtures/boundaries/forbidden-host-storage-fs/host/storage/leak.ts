import { readFileSync } from 'node:fs';
export const leak = (): string => readFileSync('x', 'utf8');
