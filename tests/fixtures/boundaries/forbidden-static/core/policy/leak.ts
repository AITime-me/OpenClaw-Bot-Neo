import { send } from '../../adapters/telegram-client.js';
export const leak = (): string => send('payload');
