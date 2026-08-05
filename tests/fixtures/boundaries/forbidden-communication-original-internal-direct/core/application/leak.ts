import { issueAuthenticatedCommunicationPrincipal } from '../communication/domain/authenticated-communication-principal.internal.js';

export const leak = (): unknown => issueAuthenticatedCommunicationPrincipal;
