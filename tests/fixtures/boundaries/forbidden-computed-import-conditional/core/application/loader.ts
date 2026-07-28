export const load = (flag: boolean) => import(flag ? './a.js' : './b.js');
