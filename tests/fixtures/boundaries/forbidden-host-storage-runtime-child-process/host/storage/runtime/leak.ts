import { spawn } from 'node:child_process';
export const leak = (): unknown => spawn;
