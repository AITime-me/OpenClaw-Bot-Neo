import { send } from '../../channels/telegram.js';
export const leak = (payload: string): string => send(payload);
