import type { ScenarioOutput } from "../domain/types.js";
import { scenarioNames } from "./definitions.js";
import { runScenario } from "./run-scenario.js";

export async function runAllScenarios(): Promise<ScenarioOutput[]> {
  const outputs: ScenarioOutput[] = [];
  for (const name of scenarioNames) {
    outputs.push(await runScenario(name));
  }
  return outputs;
}
