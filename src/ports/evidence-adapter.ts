import type { EvidenceArtifact } from "../domain/types.js";

export interface EvidenceAdapter<TContext = unknown> {
  readonly id: string;
  readonly version: string;
  collect(context: TContext): Promise<EvidenceArtifact[]>;
}
