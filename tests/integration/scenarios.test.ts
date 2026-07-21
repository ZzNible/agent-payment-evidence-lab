import { beforeAll, describe, expect, it } from "vitest";

import type { ScenarioOutput, VerificationReport } from "../../src/domain/types.js";
import {
  scenarioNames,
  type ScenarioName
} from "../../src/scenarios/definitions.js";
import { runAllScenarios } from "../../src/scenarios/run-all.js";
import { sha256 } from "../../src/security/digest.js";

describe("the six executable evidence scenarios", () => {
  let outputs: Map<ScenarioName, ScenarioOutput>;

  beforeAll(async () => {
    const results = await runAllScenarios();
    outputs = new Map(results.map(result => [result.scenario as ScenarioName, result]));
  });

  it("runs every declared scenario and binds every report to its exact inputs", () => {
    expect([...outputs.keys()]).toEqual(scenarioNames);

    for (const output of outputs.values()) {
      expect(output.report.inputs).toEqual({
        planDigest: sha256(output.plan),
        bundleDigest: sha256(output.bundle)
      });
      expect(output.report.economicAction).toBe("NOT_EVALUATED");
      expect(output.report.disclaimerCode).toBe("EVIDENCE_ANALYSIS_ONLY");
      expect(getClaim(output, "obligation-fulfilled")).toMatchObject({
        status: "UNKNOWN",
        reasonCode: "COMMERCIAL_OBLIGATION_NOT_EVALUATED"
      });
      expect(getClaim(output, "onchain-settlement")).toMatchObject({
        status: "UNKNOWN",
        reasonCode: "NO_ONCHAIN_CONFIRMATION_EVIDENCE"
      });
    }
  });

  it("proves only the declared technical predicates for a valid synchronous response", () => {
    const output = getOutput("valid-synchronous");

    expect(getClaim(output, "payment-verified").status).toBe("PROVEN");
    expect(getClaim(output, "settlement-boundary").status).toBe("PROVEN");
    expect(getClaim(output, "http-status").status).toBe("PROVEN");
    expect(getClaim(output, "output-schema")).toMatchObject({
      status: "PROVEN",
      reasonCode: "JSON_SCHEMA_MATCH"
    });
    expect(getClaim(output, "response-bound-to-payment")).toMatchObject({
      status: "UNKNOWN",
      reasonCode: "PAYMENT_RECEIPT_HAS_NO_RESPONSE_BODY_BINDING"
    });
  });

  it("records that x402/Express skips settlement after a handler 500", () => {
    const output = getOutput("handler-500");

    expect(getClaim(output, "payment-verified").status).toBe("PROVEN");
    expect(getClaim(output, "settlement-boundary")).toMatchObject({
      status: "NOT_PROVEN",
      reasonCode: "SETTLEMENT_SKIPPED_AFTER_HANDLER_FAILURE"
    });
    expect(output.bundle.artifacts.some(artifact => artifact.kind === "x402.settlement-boundary"))
      .toBe(false);
    expect(output.bundle.artifacts.some(artifact => artifact.kind === "x402.payment-cancellation"))
      .toBe(true);
    expect(output.trace.some(event => event.type === "facilitator.settle")).toBe(false);
    const cancellation = output.trace.find(event => event.type === "x402.payment-canceled");
    expect(cancellation).toBeDefined();
    expect(cancellation?.details.reason).toBe("handler_failed");
    expect(cancellation?.details.responseStatus).toBe(500);
  });

  it("distinguishes a settled HTTP 200 from an output that satisfies the schema", () => {
    const output = getOutput("settled-invalid-schema");

    expect(getClaim(output, "settlement-boundary").status).toBe("PROVEN");
    expect(getClaim(output, "http-status").status).toBe("PROVEN");
    expect(getClaim(output, "output-schema")).toMatchObject({
      status: "NOT_PROVEN",
      reasonCode: "JSON_SCHEMA_MISMATCH"
    });
  });

  it("separates synchronous acceptance and settlement from later asynchronous failure", () => {
    const output = getOutput("accepted-then-async-failure");

    expect(getClaim(output, "settlement-boundary").status).toBe("PROVEN");
    expect(getClaim(output, "http-status").status).toBe("PROVEN");
    expect(getClaim(output, "job-terminal-success")).toMatchObject({
      status: "NOT_PROVEN",
      reasonCode: "JOB_REPORTED_TERMINAL_FAILURE"
    });
  });

  it("authenticates a provider statement without treating it as independent", () => {
    const output = getOutput("self-attested-completion");

    expect(getClaim(output, "source-statement").status).toBe("PROVEN");
    expect(getClaim(output, "source-authenticated").status).toBe("PROVEN");
    expect(getClaim(output, "source-independent")).toMatchObject({
      status: "NOT_PROVEN",
      reasonCode: "SOURCE_CONTROLLED_BY_TRANSACTION_PARTY"
    });
    expect(getClaim(output, "source-authoritative")).toMatchObject({
      status: "UNKNOWN",
      reasonCode: "SOURCE_AUTHORITY_NOT_ESTABLISHED"
    });
  });

  it("does not infer independence or authority from a separate signed source", () => {
    const output = getOutput("independent-source-statement");

    expect(getClaim(output, "source-authenticated").status).toBe("PROVEN");
    expect(getClaim(output, "source-independent")).toMatchObject({
      status: "UNKNOWN",
      reasonCode: "SOURCE_INDEPENDENCE_NOT_ESTABLISHED"
    });
    expect(getClaim(output, "source-authoritative")).toMatchObject({
      status: "UNKNOWN",
      reasonCode: "SOURCE_AUTHORITY_NOT_ESTABLISHED"
    });
    expect(getClaim(output, "obligation-fulfilled").status).toBe("UNKNOWN");
  });

  function getOutput(name: ScenarioName): ScenarioOutput {
    const output = outputs.get(name);
    expect(output, `missing scenario ${name}`).toBeDefined();
    return output!;
  }
});

function getClaim(
  output: ScenarioOutput,
  id: string
): VerificationReport["claims"][number] {
  const result = output.report.claims.find(claim => claim.id === id);
  expect(result, `missing claim ${id} in ${output.scenario}`).toBeDefined();
  return result!;
}
