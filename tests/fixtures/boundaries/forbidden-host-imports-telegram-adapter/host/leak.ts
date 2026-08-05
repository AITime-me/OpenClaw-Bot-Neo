import { send } from '../adapters/telegram.js';

export const leak = (payload: string): string => send(payload);
