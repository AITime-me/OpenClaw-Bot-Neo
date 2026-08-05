import type { AuthenticatedCommunicationPrincipal } from './authenticated-communication-principal.js';

export const issuePrincipal = (): AuthenticatedCommunicationPrincipal =>
  Object.freeze({}) as AuthenticatedCommunicationPrincipal;
