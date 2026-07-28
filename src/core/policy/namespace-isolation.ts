import type { MemoryNamespace } from '../domain/index.js';
export type NamespaceDecision =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: string };
export function checkNamespaceAccess(
  active: MemoryNamespace | null,
  target: MemoryNamespace,
  crossProjectApproved: boolean,
): NamespaceDecision {
  if (active === null) return { allowed: false, reason: 'Active namespace is required.' };
  if (active === target) return { allowed: true };
  if (target === 'security-restricted' || active === 'security-restricted')
    return { allowed: false, reason: 'Security-restricted memory is isolated.' };
  if (target === 'personal' || active === 'personal')
    return { allowed: false, reason: 'Personal memory is isolated from projects.' };
  return crossProjectApproved
    ? { allowed: true }
    : { allowed: false, reason: 'Cross-project access requires explicit approval.' };
}
