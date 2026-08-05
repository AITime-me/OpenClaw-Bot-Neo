import { issuePrincipal } from '../communication/domain/authenticated-communication-principal.internal.js';

export const leak = (): unknown => issuePrincipal();
