import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { ScenarioOutput } from "../domain/types.js";
import { validateDocument } from "../engine/schema-validator.js";
import { JsonReporter } from "./json-reporter.js";
import { MarkdownReporter } from "./markdown-reporter.js";

const json = new JsonReporter();
const markdown = new MarkdownReporter();

export async function writeScenarioOutput(
  output: ScenarioOutput,
  baseDirectory: string
): Promise<string> {
  await Promise.all([
    validateDocument("plan", output.plan),
    validateDocument("bundle", output.bundle),
    validateDocument("report", output.report)
  ]);

  const directory = resolve(baseDirectory, output.scenario);
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(resolve(directory, "verification-plan.json"), json.render(output.plan), "utf8"),
    writeFile(resolve(directory, "evidence-bundle.json"), json.render(output.bundle), "utf8"),
    writeFile(resolve(directory, "verification-report.json"), json.render(output.report), "utf8"),
    writeFile(resolve(directory, "trace.json"), json.render(output.trace), "utf8"),
    writeFile(resolve(directory, "report.md"), markdown.render(output.report, output), "utf8")
  ]);
  return directory;
}
