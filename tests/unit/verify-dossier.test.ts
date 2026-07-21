import { describe, expect, it } from "vitest";

import { analyzeEvidence } from "../../src/engine/analyze.js";
import { verifyDossier } from "../../src/engine/verify-dossier.js";
import { MarkdownReporter } from "../../src/reporters/markdown-reporter.js";
import { FIXED_TIME, makeArtifact, makeBundle, makePlan } from "../helpers/fixtures.js";

describe("dossier reproduction", () => {
  it("recomputes the stored report and Markdown projection", async () => {
    const plan = makePlan([{ id: "digest", type: "DIGEST_VALID" }]);
    const bundle = makeBundle([makeArtifact()]);
    const report = await analyzeEvidence(plan, bundle, { now: () => new Date(FIXED_TIME) });
    const scenario = { scenario: "fixture", plan, bundle, report, trace: [] };
    const markdown = new MarkdownReporter().render(report, scenario);

    await expect(verifyDossier({ ...scenario, markdown })).resolves.toBeUndefined();
  });

  it("rejects a schema-valid report whose input commitment was forged", async () => {
    const plan = makePlan([{ id: "digest", type: "DIGEST_VALID" }]);
    const bundle = makeBundle([makeArtifact()]);
    const report = await analyzeEvidence(plan, bundle, { now: () => new Date(FIXED_TIME) });
    const forged = {
      ...report,
      inputs: { ...report.inputs, planDigest: `sha256:${"0".repeat(64)}` }
    };

    await expect(
      verifyDossier({ scenario: "forged", plan, bundle, report: forged })
    ).rejects.toThrow("not reproducible");
  });

  it("does not let a stored report select the verifier engine version", async () => {
    const plan = makePlan([{ id: "digest", type: "DIGEST_VALID" }]);
    const bundle = makeBundle([makeArtifact()]);
    const report = await analyzeEvidence(plan, bundle, { now: () => new Date(FIXED_TIME) });
    const forged = { ...report, engine: { ...report.engine, version: "999.0.0" } };

    await expect(
      verifyDossier({ scenario: "forged-engine", plan, bundle, report: forged })
    ).rejects.toThrow("this executable can reproduce only 0.1.0");
  });
});
