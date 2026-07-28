const manifest = { path: './plugin.js' };
export const load = () => import(manifest.path);
