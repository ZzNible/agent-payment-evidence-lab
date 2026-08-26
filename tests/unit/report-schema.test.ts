import { readFile } from "node:fs/promises";

import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats, { type FormatsPlugin } from "ajv-formats";
import { describe, expect, it } from "vitest";

describe("verification report JSON Schema", () => {
  it("accepts NOT_EVALUATED and rejects fund-moving economic actions", async () => {
    const validate = await reportValidator();
    const report = validSchemaReport();

    expect(validate(report), JSON.stringify(validate.errors)).toBe(true);

    for (const economicAction of ["RELEASE", "REFUND", "RETAIN", "CHARGE", "TRANSFER"]) {
      expect(validate({ ...report, economicAction }), economicAction).toBe(false);
    }

    expect(validate({ ...report, releaseFunds: true })).toBe(false);
  });

  it("accepts only reason codes that belong to the declared claim type and status", async () => {
    const validate = await reportValidator();
    const report = validSchemaReport();
    const validClaims = [
      claimResult("PAYMENT_VERIFIED", "PROVEN", "FACILITATOR_ACCEPTED_PAYMENT_PAYLOAD"),
      claimResult("SETTLEMENT_BOUNDARY_SUCCEEDED", "PROVEN", "LOCAL_SETTLEMENT_BOUNDARY_SUCCEEDED"),
      claimResult("ONCHAIN_SETTLEMENT", "UNKNOWN", "NO_ONCHAIN_CONFIRMATION_EVIDENCE"),
      claimResult("ONCHAIN_SETTLEMENT", "PROVEN", "NEC_ONCHAIN_PAYMENT_EFFECT_FINALIZED"),
      claimResult("ONCHAIN_SETTLEMENT", "NOT_PROVEN", "NEC_FINALITY_CONTRADICTED"),
      claimResult("ONCHAIN_SETTLEMENT", "UNKNOWN", "NEC_FINALITY_INSUFFICIENT"),
      claimResult("ONCHAIN_SETTLEMENT", "UNKNOWN", "NEC_FINALITY_AMBIGUOUS"),
      claimResult("ONCHAIN_SETTLEMENT", "NOT_PROVEN", "NEC_EXECUTION_CONTRADICTED"),
      claimResult("ONCHAIN_SETTLEMENT", "UNKNOWN", "NEC_EXECUTION_INSUFFICIENT"),
      claimResult("ONCHAIN_SETTLEMENT", "UNKNOWN", "NEC_EXECUTION_AMBIGUOUS"),
      claimResult("ONCHAIN_SETTLEMENT", "NOT_PROVEN", "NEC_DATABINDING_CONTRADICTED"),
      claimResult("ONCHAIN_SETTLEMENT", "UNKNOWN", "NEC_DATABINDING_INSUFFICIENT"),
      claimResult("ONCHAIN_SETTLEMENT", "UNKNOWN", "NEC_DATABINDING_AMBIGUOUS"),
      claimResult("ONCHAIN_SETTLEMENT", "UNKNOWN", "NEC_PAYMENT_EFFECT_UNUSABLE"),
      claimResult("HTTP_RESPONSE_RECEIVED", "PROVEN", "HTTP_RESPONSE_CAPTURED"),
      claimResult("HTTP_STATUS_MATCH", "PROVEN", "HTTP_STATUS_MATCHED"),
      claimResult("OUTPUT_SCHEMA_VALID", "PROVEN", "JSON_SCHEMA_MATCH"),
      claimResult("JOB_TERMINAL_SUCCESS", "PROVEN", "JOB_REPORTED_TERMINAL_SUCCESS"),
      claimResult("DIGEST_VALID", "PROVEN", "ALL_SELECTED_DIGESTS_VALID"),
      claimResult("CORRELATION_MATCH", "PROVEN", "INTERACTION_CORRELATION_MATCHED"),
      claimResult("SOURCE_STATEMENT_OBSERVED", "PROVEN", "SOURCE_STATEMENT_MATCHED"),
      claimResult("SOURCE_AUTHENTICATED", "PROVEN", "ED25519_SIGNATURE_VALID"),
      claimResult(
        "SOURCE_INDEPENDENT",
        "PROVEN",
        "SOURCE_INDEPENDENT_UNDER_DECLARED_TRUST_PROFILE"
      ),
      claimResult(
        "SOURCE_AUTHORITATIVE",
        "PROVEN",
        "SOURCE_AUTHORITATIVE_UNDER_DECLARED_TRUST_PROFILE"
      ),
      claimResult(
        "RESPONSE_BODY_BOUND_TO_PAYMENT",
        "PROVEN",
        "RESPONSE_BODY_DIGEST_BOUND_TO_SETTLEMENT"
      ),
      claimResult(
        "OBLIGATION_FULFILLED",
        "UNKNOWN",
        "COMMERCIAL_OBLIGATION_NOT_EVALUATED"
      )
    ];

    for (const claim of validClaims) {
      expect(
        validate(reportWithClaim(report, claim)),
        `${String(claim.type)}: ${JSON.stringify(validate.errors)}`
      ).toBe(true);
    }

    const invalidClaims = [
      claimResult("OBLIGATION_FULFILLED", "PROVEN", "JSON_SCHEMA_MATCH"),
      claimResult("ONCHAIN_SETTLEMENT", "PROVEN", "JSON_SCHEMA_MATCH"),
      claimResult("PAYMENT_VERIFIED", "PROVEN", "JSON_SCHEMA_MATCH"),
      claimResult("SOURCE_INDEPENDENT", "PROVEN", "ED25519_SIGNATURE_VALID"),
      claimResult("HTTP_STATUS_MATCH", "PROVEN", "HTTP_RESPONSE_CAPTURED"),
      // The retired flattening codes must not re-enter any tuple.
      claimResult("ONCHAIN_SETTLEMENT", "NOT_PROVEN", "NEC_FINALITY_NOT_SUPPORTED"),
      claimResult("ONCHAIN_SETTLEMENT", "NOT_PROVEN", "NEC_EXECUTION_NOT_SUPPORTED"),
      // INSUFFICIENT/AMBIGUOUS are evidence-boundary outcomes, never negatives.
      claimResult("ONCHAIN_SETTLEMENT", "NOT_PROVEN", "NEC_FINALITY_INSUFFICIENT"),
      claimResult("ONCHAIN_SETTLEMENT", "NOT_PROVEN", "NEC_FINALITY_AMBIGUOUS")
    ];

    for (const claim of invalidClaims) {
      expect(
        validate(reportWithClaim(report, claim)),
        `${String(claim.type)}/${String(claim.reasonCode)}`
      ).toBe(false);
    }
  });
});

describe("verification plan JSON Schema", () => {
  it("accepts only canonical atomic amounts in ONCHAIN_SETTLEMENT expectations", async () => {
    const validate = await planValidator();
    const plan = validSchemaPlan();

    expect(validate(plan), JSON.stringify(validate.errors)).toBe(true);
    expect(validate(withAmount(plan, "0")), "zero").toBe(true);
    expect(validate(withAmount(plan, "27146486")), "plain integer").toBe(true);

    for (const amount of ["007", "00", "-1", "+1", "", " 1", "0x10", "1_000", "1e3"]) {
      expect(validate(withAmount(plan, amount)), `amount ${JSON.stringify(amount)}`).toBe(false);
    }
  });

  it("keeps addresses and transaction hashes lowercase and exact", async () => {
    const validate = await planValidator();
    const plan = validSchemaPlan();

    const mixedCase = JSON.parse(JSON.stringify(plan)) as Record<string, unknown>;
    const claims = mixedCase.claims as Array<Record<string, unknown>>;
    const claim0 = claims[0];
    if (claim0 === undefined) {
      throw new Error("plan fixture lost its claim");
    }
    const parameters = claim0.parameters as Record<string, unknown>;
    const payment = parameters.payment as Record<string, unknown>;
    payment.transactionHash = (payment.transactionHash as string).toUpperCase();
    expect(validate(mixedCase)).toBe(false);
  });
});

async function reportValidator(): Promise<ValidateFunction> {
  const schemaUrl = new URL("../../schemas/verification-report.schema.json", import.meta.url);
  const schema = JSON.parse(await readFile(schemaUrl, "utf8")) as object;
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const installFormats = addFormats as unknown as FormatsPlugin;
  installFormats(ajv);
  return ajv.compile(schema);
}

function claimResult(type: string, status: string, reasonCode: string): Record<string, unknown> {
  return {
    id: "claim-1",
    type,
    status,
    reasonCode,
    evidence: status === "UNKNOWN" ? [] : ["artifact-1"],
    limitations: []
  };
}

function reportWithClaim(
  report: Record<string, unknown>,
  claim: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...report,
    claims: [claim],
    summary: {
      proven: claim.status === "PROVEN" ? 1 : 0,
      notProven: claim.status === "NOT_PROVEN" ? 1 : 0,
      unknown: claim.status === "UNKNOWN" ? 1 : 0
    }
  };
}

async function planValidator(): Promise<ValidateFunction> {
  const schemaUrl = new URL("../../schemas/verification-plan.schema.json", import.meta.url);
  const schema = JSON.parse(await readFile(schemaUrl, "utf8")) as object;
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const installFormats = addFormats as unknown as FormatsPlugin;
  installFormats(ajv);
  return ajv.compile(schema);
}

function validSchemaPlan(): Record<string, unknown> {
  return {
    specVersion: "apel.verification-plan/0.2",
    planId: "plan-1",
    createdAt: "2026-07-21T10:00:00.000Z",
    subject: {
      interactionId: "interaction-1",
      resource: "https://resource.example/api"
    },
    claims: [
      {
        id: "onchain-settlement",
        type: "ONCHAIN_SETTLEMENT",
        parameters: {
          artifactId: "nec-evidence-1",
          issuerId: "nec-network-verifier",
          payment: {
            network: "eip155:8453",
            asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
            payer: "0x8f6272112c3b71474f6e24a8ad0be3b253123474",
            payTo: "0x3c4384f3664b37a3cb5a5cb3452b4b4a3aa1256f",
            amount: "27146486",
            transactionHash: `0x${"ab".repeat(32)}`
          }
        }
      }
    ],
    trustProfile: "nec-phase-b-demo",
    trustProfileDigest: `sha256:${"2".repeat(64)}`
  };
}

function withAmount(plan: Record<string, unknown>, amount: string): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(plan)) as Record<string, unknown>;
  const claims = clone.claims as Array<Record<string, unknown>>;
  const claim = claims[0];
  if (claim === undefined) {
    throw new Error("plan fixture lost its claim");
  }
  ((claim.parameters as Record<string, unknown>).payment as Record<string, unknown>).amount = amount;
  return clone;
}

function validSchemaReport(): Record<string, unknown> {
  return {
    specVersion: "apel.verification-report/0.2",
    reportId: "report-1",
    generatedAt: "2026-07-21T10:00:00.000Z",
    engine: {
      name: "agent-payment-evidence-lab",
      version: "0.1.0"
    },
    inputs: {
      planDigest: `sha256:${"0".repeat(64)}`,
      bundleDigest: `sha256:${"1".repeat(64)}`
    },
    subject: {
      interactionId: "interaction-1",
      planId: "plan-1",
      bundleId: "bundle-1"
    },
    claims: [
      {
        id: "obligation-fulfilled",
        type: "OBLIGATION_FULFILLED",
        status: "UNKNOWN",
        reasonCode: "COMMERCIAL_OBLIGATION_NOT_EVALUATED",
        evidence: [],
        limitations: ["No payment instruction is produced."]
      }
    ],
    summary: {
      proven: 0,
      notProven: 0,
      unknown: 1
    },
    economicAction: "NOT_EVALUATED",
    disclaimerCode: "EVIDENCE_ANALYSIS_ONLY"
  };
}
