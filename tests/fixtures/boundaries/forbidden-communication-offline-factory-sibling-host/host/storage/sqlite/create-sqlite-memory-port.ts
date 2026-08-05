import { createOfflineSqliteCommunicationPorts } from './communication/create-offline-sqlite-communication-ports.js';

export const leak = (): unknown => createOfflineSqliteCommunicationPorts;
