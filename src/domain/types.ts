export const PLAN_SPEC_VERSION = "apel.verification-plan/0.2" as const;
export const BUNDLE_SPEC_VERSION = "apel.evidence-bundle/0.1" as const;
export const REPORT_SPEC_VERSION = "apel.verification-report/0.2" as const;
export const ENGINE_VERSION = "0.1.0" as const;

export const claimTypes = [
  "PAYMENT_VERIFIED",
  "SETTLEMENT_BOUNDARY_SUCCEEDED",
  "ONCHAIN_SETTLEMENT",
  "HTTP_RESPONSE_RECEIVED",
  "HTTP_STATUS_MATCH",
  "OUTPUT_SCHEMA_VALID",
  "JOB_TERMINAL_SUCCESS",
  "DIGEST_VALID",
  "CORRELATION_MATCH",
  "SOURCE_STATEMENT_OBSERVED",
  "SOURCE_AUTHENTICATED",
  "SOURCE_INDEPENDENT",
  "SOURCE_AUTHORITATIVE",
  "RESPONSE_BODY_BOUND_TO_PAYMENT",
  "OBLIGATION_FULFILLED"
] as const;

export type ClaimType = (typeof claimTypes)[number];
export type ClaimStatus = "PROVEN" | "NOT_PROVEN" | "UNKNOWN";

export interface PlanClaim {
  id: string;
  type: ClaimType;
  parameters?: Record<string, unknown>;
}

export interface VerificationPlan {
  specVersion: typeof PLAN_SPEC_VERSION;
  planId: string;
  createdAt: string;
  subject: {
    interactionId: string;
    resource: string;
  };
  claims: PlanClaim[];
  trustProfile: string;
  trustProfileDigest: string;
}

export type IssuerRole =
  | "CLIENT"
  | "PROVIDER"
  | "PAYMENT_FACILITATOR"
  | "EXTERNAL_SOURCE"
  | "INDEPENDENT_OBSERVER"
  | "LAB_FIXTURE";

export type Controller =
  | "CLIENT"
  | "PROVIDER"
  | "THIRD_PARTY"
  | "LAB_FIXTURE"
  | "UNKNOWN";

export interface ArtifactSignature {
  algorithm: "Ed25519";
  publicKey: string;
  value: string;
}

export interface EvidenceArtifact {
  id: string;
  kind: string;
  capturedAt: string;
  expiresAt?: string;
  issuer: {
    id: string;
    role: IssuerRole;
    controller: Controller;
  };
  digest: {
    algorithm: "sha256";
    value: string;
  };
  content: unknown;
  correlation: {
    interactionId: string;
  };
  signature?: ArtifactSignature;
}

export interface TrustContext {
  authoritativeSources: string[];
  independentSources: string[];
  sourcePublicKeys: Record<string, string>;
  declaredAssumptions: string[];
}

export interface EvidenceBundle {
  specVersion: typeof BUNDLE_SPEC_VERSION;
  bundleId: string;
  createdAt: string;
  subject: {
    interactionId: string;
    protocol: "x402";
    protocolVersion: string;
  };
  artifacts: EvidenceArtifact[];
  trustContext: TrustContext;
}

export interface ClaimResult {
  id: string;
  type: ClaimType;
  status: ClaimStatus;
  reasonCode: string;
  evidence: string[];
  limitations: string[];
}

export interface VerificationReport {
  specVersion: typeof REPORT_SPEC_VERSION;
  reportId: string;
  generatedAt: string;
  engine: {
    name: "agent-payment-evidence-lab";
    version: string;
  };
  inputs: {
    planDigest: string;
    bundleDigest: string;
  };
  subject: {
    interactionId: string;
    planId: string;
    bundleId: string;
  };
  claims: ClaimResult[];
  summary: {
    proven: number;
    notProven: number;
    unknown: number;
  };
  economicAction: "NOT_EVALUATED";
  disclaimerCode: "EVIDENCE_ANALYSIS_ONLY";
}

export interface ScenarioOutput {
  scenario: string;
  plan: VerificationPlan;
  bundle: EvidenceBundle;
  report: VerificationReport;
  trace: TraceEvent[];
}

export interface TraceEvent {
  sequence: number;
  at: string;
  type: string;
  details: Record<string, unknown>;
}
