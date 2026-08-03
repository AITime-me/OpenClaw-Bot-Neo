import process from 'node:process';

/** Restrictive umask for Neo-created sensitive runtime and durable state on supported Linux. */
export const applyRestrictiveProcessUmask = (): void => {
  if (process.platform === 'linux') {
    process.umask(0o077);
  }
};
