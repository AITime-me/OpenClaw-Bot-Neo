export const load = (manifest: { entry: string }) => import(manifest.entry);
