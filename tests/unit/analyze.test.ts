import { describe, expect, it } from "vitest";

import type { VerificationReport } from "../../src/domain/types.js";
import { analyzeEvidence } from "../../src/engine/analyze.js";
import { sha256 } from "../../src/security/digest.js";
import {
  createEd25519Identity,
  exportPublicKey,
  signJson
} from "../../src/security/signatures.js";
import { FIXED_TIME, makeArtifact, makeBundle, makePlan } from "../helpers/fixtures.js";

describe("evidence analysis", () => {
  it("binds the report to the exact plan and bundle without issuing an economic action", async () => {
    const artifact = makeArtifact();
    const plan = makePlan([{ id: "digest", type: "DIGEST_VALID" }]);
    const bundle = makeBundle([artifact]);

    const report = await analyzeEvidence(plan, bundle, {
      now: () => new Date(FIXED_TIME),
      engineVersion: "test"
    });

    expect(report.inputs).toEqual({
      planDigest: sha256(plan),
      bundleDigest: sha256(bundle)
    });
    expect(report.claims).toEqual([
      expect.objectContaining({
        id: "digest",
        status: "PROVEN",
        reasonCode: "ALL_SELECTED_DIGESTS_VALID"
      })
    ]);
    expect(report.economicAction).toBe("NOT_EVALUATED");
    expect(report.disclaimerCode).toBe("EVIDENCE_ANALYSIS_ONLY");
    expect(collectKeys(report)).not.toEqual(
      expect.arrayContaining(["release", "refund", "transfer", "retain", "charge"])
    );
  });

  it("detects content tampering and makes claims using that artifact UNKNOWN", async () => {
    const artifact = makeArtifact({
      content: { interaction_id: "interaction-1", job_status: "completed" }
    });
    artifact.content = { interaction_id: "interaction-1", job_status: "failed" };
    const plan = makePlan([
      { id: "digest", type: "DIGEST_VALID" },
      {
        id: "statement",
        type: "SOURCE_STATEMENT_OBSERVED",
        parameters: {
          artifactId: artifact.id,
          issuerId: artifact.issuer.id,
          interactionField: "interaction_id",
          field: "job_status",
          equals: "failed"
        }
      }
    ]);

    const report = await analyzeEvidence(plan, makeBundle([artifact]));

    expect(claim(report, "digest")).toMatchObject({
      status: "NOT_PROVEN",
      reasonCode: "ARTIFACT_DIGEST_MISMATCH",
      evidence: [artifact.id]
    });
    expect(claim(report, "statement")).toMatchObject({
      status: "UNKNOWN",
      reasonCode: "NO_VALID_SOURCE_STATEMENT",
      evidence: []
    });
  });

  it("detects tampering with provenance and correlation metadata", async () => {
    const artifact = makeArtifact();
    artifact.issuer.controller = "PROVIDER";
    artifact.correlation.interactionId = "substituted-interaction";
    const report = await analyzeEvidence(
      makePlan([{ id: "digest", type: "DIGEST_VALID" }]),
      makeBundle([artifact])
    );

    expect(claim(report, "digest")).toMatchObject({
      status: "NOT_PROVEN",
      reasonCode: "ARTIFACT_DIGEST_MISMATCH",
      evidence: [artifact.id]
    });
  });

  it("compares structured source-statement values by canonical JSON equality", async () => {
    const artifact = makeArtifact({
      id: "structured-statement",
      kind: "source.statement",
      content: {
        interaction_id: "interaction-1",
        job_result: {
          items: [{ id: "item-1", score: 1 }, { id: "item-2", score: 2 }],
          metadata: { complete: true, source: "observer" }
        }
      }
    });
    const report = await analyzeEvidence(
      makePlan([
        {
          id: "structured-value",
          type: "SOURCE_STATEMENT_OBSERVED",
          parameters: {
            artifactId: artifact.id,
            issuerId: artifact.issuer.id,
            interactionField: "interaction_id",
            field: "job_result",
            equals: {
              metadata: { source: "observer", complete: true },
              items: [{ score: 1, id: "item-1" }, { score: 2, id: "item-2" }]
            }
          }
        }
      ]),
      makeBundle([artifact])
    );

    expect(claim(report, "structured-value")).toMatchObject({
      status: "PROVEN",
      reasonCode: "SOURCE_STATEMENT_MATCHED",
      evidence: [artifact.id]
    });
  });

  it("rejects a source statement whose content names a different interaction", async () => {
    const auth = authenticationFixture("external-source");
    const artifact = makeArtifact({
      id: "cross-interaction-statement",
      kind: "source.statement",
      issuerId: "external-source",
      issuerRole: "EXTERNAL_SOURCE",
      controller: "THIRD_PARTY",
      interactionId: "interaction-1",
      signer: auth.signer,
      content: {
        interaction_id: "interaction-2",
        job_status: "completed"
      }
    });
    const report = await analyzeEvidence(
      makePlan(
        [
          {
            id: "statement",
            type: "SOURCE_STATEMENT_OBSERVED",
            parameters: {
              artifactId: artifact.id,
              issuerId: artifact.issuer.id,
              interactionField: "interaction_id",
              field: "job_status",
              equals: "completed"
            }
          }
        ],
        "interaction-1",
        auth.trustContext
      ),
      makeBundle([artifact], "interaction-1", auth.trustContext)
    );

    expect(claim(report, "statement")).toMatchObject({
      status: "NOT_PROVEN",
      reasonCode: "SOURCE_STATEMENT_INTERACTION_MISMATCH",
      evidence: [artifact.id]
    });
  });

  it("marks absent evidence UNKNOWN rather than converting absence into failure", async () => {
    const report = await analyzeEvidence(
      makePlan([
        {
          id: "response",
          type: "HTTP_RESPONSE_RECEIVED",
          parameters: { artifactId: "expected-http-response", issuerId: "local-provider" }
        }
      ]),
      makeBundle()
    );

    expect(claim(report, "response")).toMatchObject({
      status: "UNKNOWN",
      reasonCode: "NO_VALID_HTTP_RESPONSE_EVIDENCE",
      evidence: []
    });
    expect(report.summary).toEqual({ proven: 0, notProven: 0, unknown: 1 });
  });

  it("rejects a plan and bundle for different interactions", async () => {
    await expect(
      analyzeEvidence(
        makePlan([{ id: "digest", type: "DIGEST_VALID" }], "interaction-a"),
        makeBundle([], "interaction-b")
      )
    ).rejects.toThrow("different interaction IDs");
  });

  it("rejects an unsupported x402 protocol version before claim evaluation", async () => {
    const bundle = makeBundle([makeArtifact()]);
    bundle.subject.protocolVersion = "99.0.0";

    await expect(
      analyzeEvidence(
        makePlan([{ id: "digest", type: "DIGEST_VALID" }]),
        bundle
      )
    ).rejects.toThrow(
      /bundle document failed schema validation:[\s\S]*\/subject\/protocolVersion/
    );
  });

  it("reports cross-interaction artifact substitution as NOT_PROVEN", async () => {
    const foreignArtifact = makeArtifact({
      id: "foreign-artifact",
      interactionId: "interaction-b"
    });
    const report = await analyzeEvidence(
      makePlan([
        {
          id: "correlation",
          type: "CORRELATION_MATCH",
          parameters: { artifactIds: [foreignArtifact.id] }
        }
      ]),
      makeBundle([foreignArtifact])
    );

    expect(claim(report, "correlation")).toMatchObject({
      status: "NOT_PROVEN",
      reasonCode: "INTERACTION_CORRELATION_MISMATCH",
      evidence: [foreignArtifact.id]
    });
  });

  it("rejects an output schema that does not match the precommitted digest", async () => {
    const auth = authenticationFixture("lab-http-capture-adapter");
    const schema = makeArtifact({
      id: "schema",
      kind: "contract.output-schema",
      content: { type: "object", required: ["result"] }
    });
    const response = makeArtifact({
      id: "response",
      kind: "http.response",
      issuerId: "lab-http-capture-adapter",
      issuerRole: "LAB_FIXTURE",
      controller: "LAB_FIXTURE",
      signer: auth.signer,
      content: {
        resourceUrl: "https://example.test/jobs/interaction-1",
        status: 200,
        headers: {},
        body: { result: "ok" }
      }
    });
    const report = await analyzeEvidence(
      makePlan(
        [
          {
            id: "schema-valid",
            type: "OUTPUT_SCHEMA_VALID",
            parameters: {
              responseArtifactId: response.id,
              responseIssuerId: response.issuer.id,
              schemaArtifactId: schema.id,
              schemaDigest: sha256({ type: "string" })
            }
          }
        ],
        "interaction-1",
        auth.trustContext
      ),
      makeBundle([schema, response], "interaction-1", auth.trustContext)
    );

    expect(claim(report, "schema-valid")).toMatchObject({
      status: "NOT_PROVEN",
      reasonCode: "SCHEMA_COMMITMENT_MISMATCH",
      evidence: [schema.id]
    });
  });

  it("computes response-body binding against the observed body", async () => {
    const auth = authenticationFixture(
      "lab-http-capture-adapter",
      "local-recording-facilitator"
    );
    const body = { result: "bound" };
    const response = makeArtifact({
      id: "response",
      kind: "http.response",
      issuerId: "lab-http-capture-adapter",
      issuerRole: "LAB_FIXTURE",
      controller: "LAB_FIXTURE",
      signer: auth.signer,
      content: {
        resourceUrl: "https://example.test/jobs/interaction-1",
        status: 200,
        headers: {},
        body
      }
    });
    const settlement = makeArtifact({
      id: "settlement",
      kind: "x402.settlement-boundary",
      issuerId: "local-recording-facilitator",
      issuerRole: "PAYMENT_FACILITATOR",
      controller: "LAB_FIXTURE",
      signer: auth.signer,
      content: {
        success: true,
        mode: "local-recording-double",
        realFundsMoved: false,
        responseBodyDigest: sha256(body)
      }
    });
    const plan = makePlan(
      [
        {
          id: "body-binding",
          type: "RESPONSE_BODY_BOUND_TO_PAYMENT",
          parameters: {
            responseArtifactId: response.id,
            responseIssuerId: response.issuer.id,
            settlementArtifactId: settlement.id,
            settlementIssuerId: settlement.issuer.id
          }
        }
      ],
      "interaction-1",
      auth.trustContext
    );

    const matching = await analyzeEvidence(
      plan,
      makeBundle([response, settlement], "interaction-1", auth.trustContext)
    );
    expect(claim(matching, "body-binding")).toMatchObject({
      status: "PROVEN",
      reasonCode: "RESPONSE_BODY_DIGEST_BOUND_TO_SETTLEMENT"
    });

    const wrongSettlement = makeArtifact({
      id: "settlement",
      kind: "x402.settlement-boundary",
      issuerId: "local-recording-facilitator",
      issuerRole: "PAYMENT_FACILITATOR",
      controller: "LAB_FIXTURE",
      signer: auth.signer,
      content: {
        success: true,
        mode: "local-recording-double",
        realFundsMoved: false,
        responseBodyDigest: sha256({ result: "different" })
      }
    });
    const mismatch = await analyzeEvidence(
      plan,
      makeBundle([response, wrongSettlement], "interaction-1", auth.trustContext)
    );
    expect(claim(mismatch, "body-binding")).toMatchObject({
      status: "NOT_PROVEN",
      reasonCode: "RESPONSE_BODY_BINDING_MISMATCH"
    });
  });

  it("does not authenticate a declared issuer from a self-selected signing key", async () => {
    const identity = createEd25519Identity();
    const content = { job_status: "completed" };
    const artifact = makeArtifact({ content, signer: envelope => signJson(envelope, identity) });
    const report = await analyzeEvidence(
      makePlan([
        {
          id: "source-authenticated",
          type: "SOURCE_AUTHENTICATED",
          parameters: { artifactId: artifact.id, issuerId: artifact.issuer.id }
        }
      ]),
      makeBundle([artifact])
    );

    expect(claim(report, "source-authenticated")).toMatchObject({
      status: "UNKNOWN",
      reasonCode: "SOURCE_KEY_NOT_BOUND_TO_ISSUER"
    });
  });

  it("rejects a signature whose key differs from the issuer binding", async () => {
    const signer = createEd25519Identity();
    const expected = createEd25519Identity();
    const content = { job_status: "completed" };
    const artifact = makeArtifact({ content, signer: envelope => signJson(envelope, signer) });
    const trustContext = {
      authoritativeSources: [],
      independentSources: [],
      sourcePublicKeys: { "source-1": exportPublicKey(expected) },
      declaredAssumptions: []
    };
    const report = await analyzeEvidence(
      makePlan(
        [
          {
            id: "source-authenticated",
            type: "SOURCE_AUTHENTICATED",
            parameters: { artifactId: artifact.id, issuerId: artifact.issuer.id }
          }
        ],
        "interaction-1",
        trustContext
      ),
      makeBundle([artifact], "interaction-1", trustContext)
    );

    expect(claim(report, "source-authenticated")).toMatchObject({
      status: "NOT_PROVEN",
      reasonCode: "SOURCE_KEY_BINDING_MISMATCH"
    });
  });

  it("does not accept payment verification issued by the client even when signed and bound", async () => {
    const auth = authenticationFixture("malicious-client");
    const payment = makeArtifact({
      id: "client-payment-verification",
      kind: "x402.payment-verification",
      issuerId: "malicious-client",
      issuerRole: "CLIENT",
      controller: "CLIENT",
      signer: auth.signer,
      content: {
        isValid: true,
        mode: "local-recording-double",
        realNetworkVerification: false,
        paymentPayload: {
          resource: { url: "https://example.test/jobs/interaction-1" }
        }
      }
    });
    const report = await analyzeEvidence(
      makePlan(
        [
          {
            id: "payment",
            type: "PAYMENT_VERIFIED",
            parameters: { artifactId: payment.id, issuerId: payment.issuer.id }
          }
        ],
        "interaction-1",
        auth.trustContext
      ),
      makeBundle([payment], "interaction-1", auth.trustContext)
    );

    expect(claim(report, "payment")).toMatchObject({
      status: "NOT_PROVEN",
      reasonCode: "ARTIFACT_ISSUER_ROLE_MISMATCH",
      evidence: [payment.id]
    });
  });

  it("does not let an authenticated issuer sharing the same key replace the precommitted issuer", async () => {
    const auth = authenticationFixture("expected-facilitator", "substitute-facilitator");
    const payment = makeArtifact({
      id: "substitute-payment-verification",
      kind: "x402.payment-verification",
      issuerId: "substitute-facilitator",
      issuerRole: "PAYMENT_FACILITATOR",
      controller: "LAB_FIXTURE",
      signer: auth.signer,
      content: {
        isValid: true,
        paymentPayload: {
          resource: { url: "https://example.test/jobs/interaction-1" }
        }
      }
    });
    const report = await analyzeEvidence(
      makePlan(
        [
          {
            id: "payment",
            type: "PAYMENT_VERIFIED",
            parameters: {
              artifactId: payment.id,
              issuerId: "expected-facilitator"
            }
          }
        ],
        "interaction-1",
        auth.trustContext
      ),
      makeBundle([payment], "interaction-1", auth.trustContext)
    );

    expect(claim(report, "payment")).toMatchObject({
      status: "NOT_PROVEN",
      reasonCode: "ARTIFACT_ISSUER_MISMATCH",
      evidence: [payment.id]
    });
  });

  it("does not use an authenticated payment for resource B to prove resource A", async () => {
    const auth = authenticationFixture("recording-facilitator");
    const payment = makeArtifact({
      id: "payment-for-resource-b",
      kind: "x402.payment-verification",
      issuerId: "recording-facilitator",
      issuerRole: "PAYMENT_FACILITATOR",
      controller: "LAB_FIXTURE",
      signer: auth.signer,
      content: {
        isValid: true,
        mode: "local-recording-double",
        realNetworkVerification: false,
        paymentPayload: {
          resource: { url: "https://example.test/jobs/resource-b" }
        }
      }
    });
    const report = await analyzeEvidence(
      makePlan(
        [
          {
            id: "payment",
            type: "PAYMENT_VERIFIED",
            parameters: { artifactId: payment.id, issuerId: payment.issuer.id }
          }
        ],
        "interaction-1",
        auth.trustContext
      ),
      makeBundle([payment], "interaction-1", auth.trustContext)
    );

    expect(claim(report, "payment")).toMatchObject({
      status: "NOT_PROVEN",
      reasonCode: "PAYMENT_RESOURCE_MISMATCH",
      evidence: [payment.id]
    });
  });

  it("keeps an authenticated provider response with null content UNKNOWN", async () => {
    const auth = authenticationFixture("lab-http-capture-adapter");
    const response = makeArtifact({
      id: "null-response",
      kind: "http.response",
      issuerId: "lab-http-capture-adapter",
      issuerRole: "LAB_FIXTURE",
      controller: "LAB_FIXTURE",
      signer: auth.signer,
      content: null
    });
    const report = await analyzeEvidence(
      makePlan(
        [
          {
            id: "response",
            type: "HTTP_RESPONSE_RECEIVED",
            parameters: { artifactId: response.id, issuerId: response.issuer.id }
          }
        ],
        "interaction-1",
        auth.trustContext
      ),
      makeBundle([response], "interaction-1", auth.trustContext)
    );

    expect(claim(report, "response")).toMatchObject({
      status: "UNKNOWN",
      reasonCode: "HTTP_RESPONSE_SHAPE_INVALID",
      evidence: [response.id]
    });
  });

  it("keeps an authenticated job status UNKNOWN when its source is not authoritative", async () => {
    const auth = authenticationFixture("lab-http-capture-adapter", "lab-job-state-adapter");
    const response = makeArtifact({
      id: "accepted-response",
      kind: "http.response",
      issuerId: "lab-http-capture-adapter",
      issuerRole: "LAB_FIXTURE",
      controller: "LAB_FIXTURE",
      signer: auth.signer,
      content: {
        resourceUrl: "https://example.test/jobs/interaction-1",
        status: 202,
        headers: {},
        body: { jobId: "job-1" }
      }
    });
    const job = makeArtifact({
      id: "job-status",
      kind: "job.status",
      issuerId: "lab-job-state-adapter",
      issuerRole: "LAB_FIXTURE",
      controller: "LAB_FIXTURE",
      signer: auth.signer,
      content: { id: "job-1", status: "completed" }
    });
    const report = await analyzeEvidence(
      makePlan(
        [
          {
            id: "job-terminal",
            type: "JOB_TERMINAL_SUCCESS",
            parameters: {
              artifactId: job.id,
              issuerId: job.issuer.id,
              responseArtifactId: response.id,
              responseIssuerId: response.issuer.id
            }
          }
        ],
        "interaction-1",
        auth.trustContext
      ),
      makeBundle([response, job], "interaction-1", auth.trustContext)
    );

    expect(claim(report, "job-terminal")).toMatchObject({
      status: "UNKNOWN",
      reasonCode: "JOB_SOURCE_AUTHORITY_NOT_ESTABLISHED",
      evidence: [job.id]
    });
  });

  it("does not accept a type-confused artifact selected by ID", async () => {
    const statementDisguisedAsResponse = makeArtifact({
      id: "not-an-http-response",
      kind: "source.statement",
      content: { status: 200, headers: {}, body: { result: "ok" } }
    });
    const report = await analyzeEvidence(
      makePlan([
        {
          id: "http-status",
          type: "HTTP_STATUS_MATCH",
          parameters: {
            artifactId: statementDisguisedAsResponse.id,
            issuerId: "local-provider",
            expected: 200
          }
        }
      ]),
      makeBundle([statementDisguisedAsResponse])
    );

    expect(claim(report, "http-status")).toMatchObject({
      status: "UNKNOWN",
      reasonCode: "NO_VALID_HTTP_RESPONSE_EVIDENCE",
      evidence: []
    });
  });

  it("keeps an explicit missing artifact selection UNKNOWN", async () => {
    const report = await analyzeEvidence(
      makePlan([
        {
          id: "digest",
          type: "DIGEST_VALID",
          parameters: { artifactIds: ["missing-artifact"] }
        }
      ]),
      makeBundle([makeArtifact()])
    );

    expect(claim(report, "digest")).toMatchObject({
      status: "UNKNOWN",
      reasonCode: "SELECTED_ARTIFACT_NOT_FOUND",
      evidence: []
    });
  });

  it("binds a terminal job status to the job ID returned by the HTTP response", async () => {
    const auth = authenticationFixture("lab-http-capture-adapter", "lab-job-state-adapter", {
      authoritativeSources: ["lab-job-state-adapter"]
    });
    const response = makeArtifact({
      id: "accepted-response",
      kind: "http.response",
      issuerId: "lab-http-capture-adapter",
      issuerRole: "LAB_FIXTURE",
      controller: "LAB_FIXTURE",
      signer: auth.signer,
      content: {
        resourceUrl: "https://example.test/jobs/interaction-1",
        status: 202,
        headers: {},
        body: { jobId: "job-requested" }
      }
    });
    const unrelatedJob = makeArtifact({
      id: "unrelated-job-status",
      kind: "job.status",
      issuerId: "lab-job-state-adapter",
      issuerRole: "LAB_FIXTURE",
      controller: "LAB_FIXTURE",
      signer: auth.signer,
      content: { id: "job-substituted", status: "completed" }
    });
    const report = await analyzeEvidence(
      makePlan(
        [
          {
            id: "job-terminal",
            type: "JOB_TERMINAL_SUCCESS",
            parameters: {
              artifactId: unrelatedJob.id,
              issuerId: unrelatedJob.issuer.id,
              responseArtifactId: response.id,
              responseIssuerId: response.issuer.id
            }
          }
        ],
        "interaction-1",
        auth.trustContext
      ),
      makeBundle([response, unrelatedJob], "interaction-1", auth.trustContext)
    );

    expect(claim(report, "job-terminal")).toMatchObject({
      status: "NOT_PROVEN",
      reasonCode: "JOB_RESPONSE_BINDING_MISMATCH",
      evidence: [response.id, unrelatedJob.id]
    });
  });

  it("does not treat an arbitrary chain confirmation artifact as verified settlement", async () => {
    const allegedConfirmation = makeArtifact({
      id: "alleged-chain-confirmation",
      kind: "chain.transaction-confirmation",
      content: {
        transactionHash: "0xdeadbeef",
        confirmed: true,
        confirmations: 999,
        final: true
      }
    });
    const report = await analyzeEvidence(
      makePlan([
        {
          id: "onchain",
          type: "ONCHAIN_SETTLEMENT",
          parameters: {
            artifactId: allegedConfirmation.id,
            issuerId: allegedConfirmation.issuer.id
          }
        }
      ]),
      makeBundle([allegedConfirmation])
    );

    expect(claim(report, "onchain")).toMatchObject({
      status: "UNKNOWN",
      reasonCode: "ONCHAIN_VERIFICATION_NOT_IMPLEMENTED",
      evidence: [allegedConfirmation.id]
    });
  });

  it("keeps contradictory settlement and cancellation evidence UNKNOWN", async () => {
    const settlement = makeArtifact({
      id: "settlement",
      kind: "x402.settlement-boundary",
      content: { success: true }
    });
    const cancellation = makeArtifact({
      id: "cancellation",
      kind: "x402.payment-cancellation",
      content: { reason: "handler_failed" }
    });
    const report = await analyzeEvidence(
      makePlan([
        {
          id: "settlement-boundary",
          type: "SETTLEMENT_BOUNDARY_SUCCEEDED",
          parameters: {
            artifactId: settlement.id,
            artifactIssuerId: settlement.issuer.id,
            cancellationArtifactId: cancellation.id,
            cancellationIssuerId: cancellation.issuer.id
          }
        }
      ]),
      makeBundle([settlement, cancellation])
    );

    expect(claim(report, "settlement-boundary")).toMatchObject({
      status: "UNKNOWN",
      reasonCode: "CONTRADICTORY_SETTLEMENT_EVIDENCE",
      evidence: [settlement.id, cancellation.id]
    });
  });

  it("rejects kind-only selection instead of choosing among matching artifacts", async () => {
    const first = makeArtifact({
      id: "response-a",
      kind: "http.response",
      content: { status: 200, headers: {}, body: { result: "first" } }
    });
    const second = makeArtifact({
      id: "response-b",
      kind: "http.response",
      content: { status: 200, headers: {}, body: { result: "second" } }
    });
    await expect(
      analyzeEvidence(
        makePlan([{ id: "response", type: "HTTP_RESPONSE_RECEIVED" }]),
        makeBundle([first, second])
      )
    ).rejects.toThrow("must have required property 'parameters'");
  });

  it("rejects duplicate claim IDs", async () => {
    await expect(
      analyzeEvidence(
        makePlan([
          { id: "duplicate", type: "DIGEST_VALID" },
          { id: "duplicate", type: "CORRELATION_MATCH" }
        ]),
        makeBundle()
      )
    ).rejects.toThrow("Duplicate claim ID: duplicate");
  });

  it("rejects duplicate artifact IDs", async () => {
    await expect(
      analyzeEvidence(
        makePlan([{ id: "digest", type: "DIGEST_VALID" }]),
        makeBundle([makeArtifact(), makeArtifact()])
      )
    ).rejects.toThrow("Duplicate artifact ID: artifact-1");
  });

  it("keeps the full commercial obligation UNKNOWN for every technical result", async () => {
    const report = await analyzeEvidence(
      makePlan([
        {
          id: "claim-0",
          type: "PAYMENT_VERIFIED",
          parameters: { artifactId: "payment", issuerId: "facilitator" }
        },
        {
          id: "claim-1",
          type: "SETTLEMENT_BOUNDARY_SUCCEEDED",
          parameters: {
            artifactId: "settlement",
            artifactIssuerId: "facilitator",
            cancellationArtifactId: "cancellation",
            cancellationIssuerId: "middleware"
          }
        },
        {
          id: "claim-2",
          type: "HTTP_RESPONSE_RECEIVED",
          parameters: { artifactId: "response", issuerId: "provider" }
        },
        { id: "claim-3", type: "OBLIGATION_FULFILLED", parameters: {} }
      ]),
      makeBundle()
    );

    expect(claim(report, "claim-3")).toMatchObject({
      status: "UNKNOWN",
      reasonCode: "COMMERCIAL_OBLIGATION_NOT_EVALUATED"
    });
    expect(report.economicAction).toBe("NOT_EVALUATED");
  });
});

function claim(report: VerificationReport, id: string): VerificationReport["claims"][number] {
  const found = report.claims.find(item => item.id === id);
  expect(found, `missing claim ${id}`).toBeDefined();
  return found!;
}

function collectKeys(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectKeys);
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => [
      key,
      ...collectKeys(entry)
    ]);
  }
  return [];
}

function authenticationFixture(
  ...args: [string, ...string[]] | [string, ...string[], { authoritativeSources: string[] }]
): {
  signer: (value: Parameters<typeof signJson>[0]) => ReturnType<typeof signJson>;
  trustContext: ReturnType<typeof makeBundle>["trustContext"];
} {
  const maybeOptions = args.at(-1);
  const hasOptions = typeof maybeOptions === "object";
  const issuerIds = (hasOptions ? args.slice(0, -1) : args) as string[];
  const authoritativeSources = hasOptions
    ? maybeOptions.authoritativeSources
    : [];
  const identity = createEd25519Identity();
  const publicKey = exportPublicKey(identity);
  return {
    signer: value => signJson(value, identity),
    trustContext: {
      authoritativeSources,
      independentSources: [],
      sourcePublicKeys: Object.fromEntries(issuerIds.map(issuerId => [issuerId, publicKey])),
      declaredAssumptions: []
    }
  };
}
