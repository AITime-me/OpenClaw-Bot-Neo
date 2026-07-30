import fs from 'node:fs';
import os from 'node:os';
import { posix as pathPosix } from 'node:path';
import { ok } from '../../../core/domain/result.js';

export const probe = (): unknown =>
  ok({
    fs: typeof fs.lstatSync,
    os: typeof os.userInfo,
    sep: pathPosix.sep,
  });
