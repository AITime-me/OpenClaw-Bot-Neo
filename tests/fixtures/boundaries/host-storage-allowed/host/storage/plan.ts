import { ok } from '../../core/domain/result.js';
import { posix as pathPosix } from 'node:path';

export const probe = (): unknown => ({ ok: ok(true), sep: pathPosix.sep });
