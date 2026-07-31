import flock from 'fs-ext-extra-prebuilt';
export const leak = (): unknown => flock;
