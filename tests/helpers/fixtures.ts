import { createArtifact } from "../../src/domain/artifacts.js";
import {
  BUNDLE_SPEC_VERSION,
  PLAN_SPEC_VERSION,
  type EvidenceArtifact,
  type EvidenceBundle,
  type PlanClaim,
  type VerificationPlan
} from "../../src/domain/types.js";
import { sha256 } from "../../src/security/digest.js";

export const FIXED_TIME = "2026-07-21T10:00:00.000Z";

export function makePlan(
  claims: PlanClaim[],
  interactionId = "interaction-1",
  trustContext: EvidenceBundle["trustContext"] = defaultTrustContext()
): VerificationPlan {
  return {
    specVersion: PLAN_SPEC_VERSION,
    planId: `plan-${interactionId}`,
    createdAt: FIXED_TIME,
    subject: {
      interactionId,
      resource: `https://example.test/jobs/${interactionId}`
    },
    claims,
    trustProfile: "unit-test-trust-profile",
    trustProfileDigest: sha256(trustContext)
  };
}

export function makeBundle(
  artifacts: EvidenceArtifact[] = [],
  interactionId = "interaction-1",
  trustContext: EvidenceBundle["trustContext"] = defaultTrustContext()
): EvidenceBundle {
  return {
    specVersion: BUNDLE_SPEC_VERSION,
    bundleId: `bundle-${interactionId}`,
    createdAt: FIXED_TIME,
    subject: {
      interactionId,
      protocol: "x402",
      protocolVersion: "2.19.0"
    },
    artifacts,
    trustContext
  };
}

function defaultTrustContext(): EvidenceBundle["trustContext"] {
  return {
    authoritativeSources: [],
    independentSources: [],
    sourcePublicKeys: {},
    declaredAssumptions: []
  };
}

export function makeArtifact(
  overrides: Partial<Parameters<typeof createArtifact>[0]> = {}
): EvidenceArtifact {
  return createArtifact({
    id: "artifact-1",
    kind: "source.statement",
    capturedAt: FIXED_TIME,
    issuerId: "source-1",
    issuerRole: "INDEPENDENT_OBSERVER",
    controller: "THIRD_PARTY",
    interactionId: "interaction-1",
    content: { status: "completed" },
    ...overrides
  });
}
