export type ConfirmationDecision =
  | { readonly decision: 'allow' }
  | { readonly decision: 'approval-required'; readonly reason: string }
  | { readonly decision: 'deny'; readonly reason: string };
export function confirmationGate(
  effect: 'read' | 'write' | 'execute' | 'external-send' | 'payment',
  approved: boolean,
): ConfirmationDecision {
  if (effect === 'payment')
    return { decision: 'deny', reason: 'Payment actions are not supported.' };
  if (effect === 'read') return { decision: 'allow' };
  return approved
    ? { decision: 'allow' }
    : { decision: 'approval-required', reason: 'Explicit owner approval is required.' };
}
