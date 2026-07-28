import { err, ok, type Result } from '../domain/index.js';
export type RecipientDecision = Result<
  { readonly allowed: true },
  { readonly code: 'RECIPIENT_DENIED' }
>;
export function checkRecipient(
  recipient: string,
  whitelist: ReadonlySet<string>,
): RecipientDecision {
  return whitelist.has(recipient) ? ok({ allowed: true }) : err({ code: 'RECIPIENT_DENIED' });
}
