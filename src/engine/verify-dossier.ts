import type {
  EvidenceBundle,
  ScenarioOutput,
  TraceEvent,
  VerificationPlan,
  VerificationReport
} from "../domain/types.js";
import { ENGINE_VERSION } from "../domain/types.js";
import { MarkdownReporter } from "../reporters/markdown-reporter.js";
import { canonicalJson } from "../security/canonical-json.js";
import { analyzeEvidence } from "./analyze.js";
import { validateDocument } from "./schema-validator.js";

export interface DossierInput {
  scenario: string;
  plan: VerificationPlan;
  bundle: EvidenceBundle;
  report: VerificationReport;
  trace?: TraceEvent[];
  markdown?: string;
}

/** Validate a dossier's schemas and reproduce its report from the committed inputs. */
export async function verifyDossier(input: DossierInput): Promise<void> {
  await Promise.all([
    validateDocument("plan", input.plan),
    validateDocument("bundle", input.bundle),
    validateDocument("report", input.report)
  ]);

  const generatedAt = new Date(input.report.generatedAt);
  if (Number.isNaN(generatedAt.getTime())) {
    throw new Error("Stored report has an invalid generatedAt timestamp.");
  }
  if (input.report.engine.version !== ENGINE_VERSION) {
    throw new Error(
      `Dossier ${input.scenario} requires engine ${input.report.engine.version}; this executable can reproduce only ${ENGINE_VERSION}.`
    );
  }
  const reproduced = await analyzeEvidence(input.plan, input.bundle, {
    now: () => generatedAt,
    engineVersion: ENGINE_VERSION
  });
  if (canonicalJson(reproduced) !== canonicalJson(input.report)) {
    throw new Error(
      `Dossier ${input.scenario} is not reproducible: the stored report differs from a fresh analysis.`
    );
  }

  if (input.markdown !== undefined) {
    const scenario: ScenarioOutput = {
      scenario: input.scenario,
      plan: input.plan,
      bundle: input.bundle,
      report: input.report,
      // The trace is a diagnostic transcript, not a committed report input.
      trace: input.trace ?? []
    };
    const expectedMarkdown = new MarkdownReporter().render(input.report, scenario);
    if (expectedMarkdown !== input.markdown) {
      throw new Error(
        `Dossier ${input.scenario} is not reproducible: report.md differs from the JSON report.`
      );
    }
  }
}
