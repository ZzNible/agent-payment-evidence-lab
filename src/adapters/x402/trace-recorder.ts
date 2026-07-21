import type { TraceEvent } from "../../domain/types.js";

export class TraceRecorder {
  readonly events: TraceEvent[] = [];

  record(type: string, details: Record<string, unknown> = {}): void {
    this.events.push({
      sequence: this.events.length + 1,
      at: new Date().toISOString(),
      type,
      details
    });
  }

  find(type: string): TraceEvent | undefined {
    return this.events.find(event => event.type === type);
  }
}
