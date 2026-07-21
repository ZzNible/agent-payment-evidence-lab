import type {
  ClaimResult,
  ClaimType,
  EvidenceBundle,
  PlanClaim,
  VerificationPlan
} from "../domain/types.js";

export interface VerificationContext {
  plan: VerificationPlan;
  bundle: EvidenceBundle;
  validArtifactIds: ReadonlySet<string>;
  evaluationTime: Date;
}

export interface ClaimVerifier {
  readonly claimTypes: readonly ClaimType[];
  verify(claim: PlanClaim, context: VerificationContext): Promise<ClaimResult> | ClaimResult;
}
