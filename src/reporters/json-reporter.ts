import type { Reporter } from "../ports/reporter.js";

export class JsonReporter implements Reporter {
  readonly extension = "json";

  render(value: unknown): string {
    return `${JSON.stringify(value, null, 2)}\n`;
  }
}
