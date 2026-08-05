import { createOfflineSqliteCommunicationPorts } from '../../host/storage/sqlite/communication/create-offline-sqlite-communication-ports.js';

export const leak = (): unknown => createOfflineSqliteCommunicationPorts;
