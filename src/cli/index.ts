#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type {
  EvidenceBundle,
  TraceEvent,
  VerificationPlan,
  VerificationReport
} from "../domain/types.js";
import { analyzeEvidence } from "../engine/analyze.js";
import { validateDocument } from "../engine/schema-validator.js";
import { verifyDossier } from "../engine/verify-dossier.js";
import { writeScenarioOutput } from "../reporters/write-output.js";
import { scenarioNames, type ScenarioName } from "../scenarios/definitions.js";
import { runAllScenarios } from "../scenarios/run-all.js";
import { runScenario } from "../scenarios/run-scenario.js";

void main(process.argv.slice(2)).catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main(args: string[]): Promise<void> {
  const command = args[0] ?? "help";
  switch (command) {
    case "demo":
      await demo(valueAfter(args, "--out") ?? "reports/generated");
      return;
    case "scenario":
      await oneScenario(args[1], valueAfter(args, "--out") ?? "reports/generated");
      return;
    case "analyze":
      await analyzeFiles(args);
      return;
    case "verify-examples":
      await verifyExamples(valueAfter(args, "--dir") ?? "reports/generated");
      return;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return;
    default:
      throw new Error(`Unknown command: ${command}. Run with --help.`);
  }
}

async function demo(outputDirectory: string): Promise<void> {
  const outputs = await runAllScenarios();
  for (const output of outputs) {
    const written = await writeScenarioOutput(output, outputDirectory);
    printSummary(output.scenario, output.report.summary, written);
  }
}

async function oneScenario(rawName: string | undefined, outputDirectory: string): Promise<void> {
  if (!isScenarioName(rawName)) {
    throw new Error(`Scenario must be one of: ${scenarioNames.join(", ")}`);
  }
  const output = await runScenario(rawName);
  const written = await writeScenarioOutput(output, outputDirectory);
  printSummary(output.scenario, output.report.summary, written);
}

async function analyzeFiles(args: string[]): Promise<void> {
  const planPath = valueAfter(args, "--plan");
  const bundlePath = valueAfter(args, "--bundle");
  if (planPath === undefined || bundlePath === undefined) {
    throw new Error("analyze requires --plan <file> and --bundle <file>.");
  }
  const plan = (await readJson(planPath)) as VerificationPlan;
  const bundle = (await readJson(bundlePath)) as EvidenceBundle;
  await Promise.all([validateDocument("plan", plan), validateDocument("bundle", bundle)]);
  const report = await analyzeEvidence(plan, bundle);
  await validateDocument("report", report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

async function verifyExamples(directory: string): Promise<void> {
  for (const name of scenarioNames) {
    const base = resolve(directory, name);
    const [plan, bundle, report, trace, markdown] = await Promise.all([
      readJson(resolve(base, "verification-plan.json")) as Promise<VerificationPlan>,
      readJson(resolve(base, "evidence-bundle.json")) as Promise<EvidenceBundle>,
      readJson(resolve(base, "verification-report.json")) as Promise<VerificationReport>,
      readJson(resolve(base, "trace.json")) as Promise<TraceEvent[]>,
      readFile(resolve(base, "report.md"), "utf8")
    ]);
    await verifyDossier({ scenario: name, plan, bundle, report, trace, markdown });
  }
  console.log(
    `Validated and reproduced plan, bundle, report, and Markdown for ${scenarioNames.length} scenario dossiers in ${resolve(directory)}. trace.json is diagnostic and is not authenticated or reproduced.`
  );
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(path), "utf8")) as unknown;
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function isScenarioName(value: string | undefined): value is ScenarioName {
  return value !== undefined && (scenarioNames as readonly string[]).includes(value);
}

function printSummary(
  scenario: string,
  summary: { proven: number; notProven: number; unknown: number },
  written: string
): void {
  console.log(
    `${scenario}: PROVEN=${summary.proven} NOT_PROVEN=${summary.notProven} UNKNOWN=${summary.unknown} -> ${written}`
  );
}

function printHelp(): void {
  console.log(`agent-payment-evidence-lab

Usage:
  apel demo [--out <directory>]
  apel scenario <name> [--out <directory>]
  apel analyze --plan <file> --bundle <file>
  apel verify-examples [--dir <directory>]

The CLI returns non-zero only for technical errors. Claim outcomes never become
payment instructions; every report fixes economicAction to NOT_EVALUATED.`);
}
