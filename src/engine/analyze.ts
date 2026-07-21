import type {
  ClaimResult,
  EvidenceBundle,
  VerificationPlan,
  VerificationReport
} from "../domain/types.js";
import { ENGINE_VERSION, REPORT_SPEC_VERSION } from "../domain/types.js";
import { artifactEnvelope } from "../domain/artifacts.js";
import type { ClaimVerifier } from "../ports/claim-verifier.js";
import { safeDigestEqual, sha256 } from "../security/digest.js";
import { CoreClaimVerifier } from "../verifiers/core-claim-verifier.js";
import { validateDocument } from "./schema-validator.js";

export interface AnalyzeOptions {
  now?: () => Date;
  engineVersion?: string;
  verifiers?: ClaimVerifier[];
}

export async function analyzeEvidence(
  plan: VerificationPlan,
  bundle: EvidenceBundle,
  options: AnalyzeOptions = {}
): Promise<VerificationReport> {
  await Promise.all([validateDocument("plan", plan), validateDocument("bundle", bundle)]);
  assertInputConsistency(plan, bundle);

  const now = options.now?.() ?? new Date();

  const validArtifactIds = new Set(
    bundle.artifacts
      .filter(artifact => safeDigestEqual(artifact.digest.value, sha256(artifactEnvelope(artifact))))
      .map(artifact => artifact.id)
  );
  const verifiers = options.verifiers ?? [new CoreClaimVerifier()];
  const verifierByType = new Map(
    verifiers.flatMap(verifier => verifier.claimTypes.map(type => [type, verifier] as const))
  );

  const claims: ClaimResult[] = [];
  for (const claim of plan.claims) {
    const verifier = verifierByType.get(claim.type);
    if (verifier === undefined) {
      claims.push({
        id: claim.id,
        type: claim.type,
        status: "UNKNOWN",
        reasonCode: "NO_REGISTERED_VERIFIER",
        evidence: [],
        limitations: []
      });
      continue;
    }
    claims.push(await verifier.verify(claim, { plan, bundle, validArtifactIds, evaluationTime: now }));
  }

  return {
    specVersion: REPORT_SPEC_VERSION,
    reportId: `report-${plan.planId}`,
    generatedAt: now.toISOString(),
    engine: {
      name: "agent-payment-evidence-lab",
      version: options.engineVersion ?? ENGINE_VERSION
    },
    inputs: {
      planDigest: sha256(plan),
      bundleDigest: sha256(bundle)
    },
    subject: {
      interactionId: plan.subject.interactionId,
      planId: plan.planId,
      bundleId: bundle.bundleId
    },
    claims,
    summary: {
      proven: claims.filter(claim => claim.status === "PROVEN").length,
      notProven: claims.filter(claim => claim.status === "NOT_PROVEN").length,
      unknown: claims.filter(claim => claim.status === "UNKNOWN").length
    },
    economicAction: "NOT_EVALUATED",
    disclaimerCode: "EVIDENCE_ANALYSIS_ONLY"
  };
}

function assertInputConsistency(plan: VerificationPlan, bundle: EvidenceBundle): void {
  if (plan.subject.interactionId !== bundle.subject.interactionId) {
    throw new Error("Plan and evidence bundle refer to different interaction IDs.");
  }
  assertUnique(plan.claims.map(claim => claim.id), "claim ID");
  assertUnique(bundle.artifacts.map(artifact => artifact.id), "artifact ID");
}

function assertUnique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`Duplicate ${label}: ${value}`);
    }
    seen.add(value);
  }
}
