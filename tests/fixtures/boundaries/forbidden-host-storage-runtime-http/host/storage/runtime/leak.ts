import http from 'node:http';
export const leak = (): unknown => http;
