import { request } from 'node:http';
export const leak = (): unknown => request;
