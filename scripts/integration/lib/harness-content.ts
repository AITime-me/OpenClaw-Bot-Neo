import { createHash } from 'node:crypto';

export const HARNESS_CONTENT = 'harness-durable-record-v1';

export const harnessContentSha256 = (): string =>
  createHash('sha256').update(HARNESS_CONTENT, 'utf8').digest('hex');
