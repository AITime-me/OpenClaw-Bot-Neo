export interface ActionPlan {
  readonly summary: string;
  readonly steps: readonly string[];
  readonly risks: readonly string[];
  readonly ownerApprovalRequired: boolean;
}
