const name = 'plugin';
export const load = () => import(`./${name}.js`);
