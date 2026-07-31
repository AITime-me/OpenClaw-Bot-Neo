import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const ext = require('fs-ext-extra-prebuilt') as { flockSync?: unknown };
export const probe = (): unknown => ({ fs, ext });
