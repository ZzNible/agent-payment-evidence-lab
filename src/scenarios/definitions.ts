import type { ClaimType, PlanClaim } from "../domain/types.js";

export const scenarioNames = [
  "valid-synchronous",
  "handler-500",
  "settled-invalid-schema",
  "accepted-then-async-failure",
  "self-attested-completion",
  "independent-source-statement"
] as const;

export type ScenarioName = (typeof scenarioNames)[number];

export interface ScenarioDefinition {
  name: ScenarioName;
  title: string;
  expectedHttpStatus: number;
  description: string;
  claims: PlanClaim[];
}

const commonClaims = (expectedHttpStatus: number): PlanClaim[] => [
  claim("artifact-digests", "DIGEST_VALID"),
  claim("interaction-correlation", "CORRELATION_MATCH"),
  claim("payment-verified", "PAYMENT_VERIFIED", {
    artifactId: "payment-verification",
    issuerId: "local-recording-facilitator"
  }),
  claim("settlement-boundary", "SETTLEMENT_BOUNDARY_SUCCEEDED", {
    artifactId: "settlement-boundary",
    artifactIssuerId: "local-recording-facilitator",
    cancellationArtifactId: "payment-cancellation",
    cancellationIssuerId: "x402-express-middleware"
  }),
  claim("onchain-settlement", "ONCHAIN_SETTLEMENT", {
    artifactId: "onchain-confirmation",
    issuerId: "chain-observer-not-configured",
    payment: {
      network: "eip155:8453",
      asset: "0x0000000000000000000000000000000000000000",
      payer: "0x0000000000000000000000000000000000000000",
      payTo: "0x0000000000000000000000000000000000000000",
      amount: "0",
      transactionHash: `0x${"0".repeat(64)}`
    }
  }),
  claim("http-response-received", "HTTP_RESPONSE_RECEIVED", {
    artifactId: "http-response",
    issuerId: "lab-http-capture-adapter"
  }),
  claim("http-status", "HTTP_STATUS_MATCH", {
    artifactId: "http-response",
    issuerId: "lab-http-capture-adapter",
    expected: expectedHttpStatus
  }),
  claim("response-bound-to-payment", "RESPONSE_BODY_BOUND_TO_PAYMENT", {
    responseArtifactId: "http-response",
    responseIssuerId: "lab-http-capture-adapter",
    settlementArtifactId: "settlement-boundary",
    settlementIssuerId: "local-recording-facilitator"
  }),
  claim("obligation-fulfilled", "OBLIGATION_FULFILLED", {})
];

export const scenarioDefinitions: Record<ScenarioName, ScenarioDefinition> = {
  "valid-synchronous": {
    name: "valid-synchronous",
    title: "Valid synchronous response",
    expectedHttpStatus: 200,
    description: "The local settlement boundary succeeds and the HTTP body matches a precommitted schema.",
    claims: [
      ...commonClaims(200),
      claim("output-schema", "OUTPUT_SCHEMA_VALID", {
        responseArtifactId: "http-response",
        responseIssuerId: "lab-http-capture-adapter",
        schemaArtifactId: "output-schema"
      })
    ]
  },
  "handler-500": {
    name: "handler-500",
    title: "Handler returns HTTP 500",
    expectedHttpStatus: 500,
    description: "x402 verifies the payment but the pinned Express middleware skips settlement after a 500.",
    claims: commonClaims(500)
  },
  "settled-invalid-schema": {
    name: "settled-invalid-schema",
    title: "Settlement boundary succeeds but output schema fails",
    expectedHttpStatus: 200,
    description: "A 200 response triggers the local settlement boundary even though the body violates the agreed schema.",
    claims: [
      ...commonClaims(200),
      claim("output-schema", "OUTPUT_SCHEMA_VALID", {
        responseArtifactId: "http-response",
        responseIssuerId: "lab-http-capture-adapter",
        schemaArtifactId: "output-schema"
      })
    ]
  },
  "accepted-then-async-failure": {
    name: "accepted-then-async-failure",
    title: "Accepted synchronously, failed asynchronously",
    expectedHttpStatus: 202,
    description: "Payment settles for an accepted job whose later terminal state is failed.",
    claims: [
      ...commonClaims(202),
      claim("job-terminal-success", "JOB_TERMINAL_SUCCESS", {
        artifactId: "job-terminal-status",
        issuerId: "lab-job-state-adapter",
        responseArtifactId: "http-response",
        responseIssuerId: "lab-http-capture-adapter"
      })
    ]
  },
  "self-attested-completion": {
    name: "self-attested-completion",
    title: "Provider self-attests completion",
    expectedHttpStatus: 200,
    description: "A valid provider signature authenticates a completion statement but does not make it independent.",
    claims: [
      ...commonClaims(200),
      ...sourceClaims("local-provider")
    ]
  },
  "independent-source-statement": {
    name: "independent-source-statement",
    title: "A separate source signs a statement",
    expectedHttpStatus: 200,
    description: "A distinct signed source identity does not automatically establish institutional independence or authority.",
    claims: [
      ...commonClaims(200),
      ...sourceClaims("lab-separate-observer")
    ]
  }
};

function sourceClaims(issuerId: string): PlanClaim[] {
  return [
    claim("source-statement", "SOURCE_STATEMENT_OBSERVED", {
      artifactId: "completion-statement",
      issuerId,
      interactionField: "interaction_id",
      field: "job_status",
      equals: "completed"
    }),
    claim("source-authenticated", "SOURCE_AUTHENTICATED", {
      artifactId: "completion-statement",
      issuerId
    }),
    claim("source-independent", "SOURCE_INDEPENDENT", {
      artifactId: "completion-statement",
      issuerId
    }),
    claim("source-authoritative", "SOURCE_AUTHORITATIVE", {
      artifactId: "completion-statement",
      issuerId
    })
  ];
}

function claim(
  id: string,
  type: ClaimType,
  parameters?: Record<string, unknown>
): PlanClaim {
  return { id, type, ...(parameters === undefined ? {} : { parameters }) };
}
