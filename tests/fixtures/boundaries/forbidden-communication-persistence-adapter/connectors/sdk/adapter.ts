import { readValidatedTextOutputPlaintextForOfflineOutbox } from '../../core/communication/domain/validated-text-output.persistence.internal.js';

export const leak = (): unknown => readValidatedTextOutputPlaintextForOfflineOutbox;
