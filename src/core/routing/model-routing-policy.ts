import { err, ok, type Result } from '../domain/index.js';
import { normalizeRisk, type RiskClass } from './risk-class.js';
import { RESTRICTED_UNTRUSTED_PROFILE, type ToolProfile } from './tool-profile.js';
export interface ModelTier {
  readonly id: string;
  readonly strength: 'economy' | 'balanced' | 'strong';
  readonly auth: 'subscription-oauth';
  readonly available: boolean;
}
export interface Route {
  readonly risk: RiskClass;
  readonly modelTierId: string;
  readonly toolProfile: ToolProfile;
  readonly ownerApprovalRequired: boolean;
}
export type RoutingError = { readonly code: 'NO_SAFE_MODEL'; readonly risk: RiskClass };
const safeProfile = (risk: RiskClass): ToolProfile =>
  risk === 'untrusted-input'
    ? RESTRICTED_UNTRUSTED_PROFILE
    : { id: `${risk}-configured`, exec: false, write: false, secrets: false, externalSend: false };
export function resolveRoute(
  rawRisk: unknown,
  tiers: readonly ModelTier[],
): Result<Route, RoutingError> {
  const risk = normalizeRisk(rawRisk);
  const eligible = tiers.filter((tier) => tier.available);
  const tier =
    risk === 'high' || risk === 'untrusted-input'
      ? eligible.find((candidate) => candidate.strength === 'strong')
      : (eligible.find(
          (candidate) => candidate.strength === (risk === 'low' ? 'economy' : 'balanced'),
        ) ?? eligible.find((candidate) => candidate.strength === 'strong'));
  if (!tier) return err({ code: 'NO_SAFE_MODEL', risk });
  return ok({
    risk,
    modelTierId: tier.id,
    toolProfile: safeProfile(risk),
    ownerApprovalRequired: risk === 'high',
  });
}
