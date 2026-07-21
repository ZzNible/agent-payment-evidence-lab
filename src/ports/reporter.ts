import type { ScenarioOutput, VerificationReport } from "../domain/types.js";

export interface Reporter {
  readonly extension: string;
  render(report: VerificationReport, scenario?: ScenarioOutput): string;
}
