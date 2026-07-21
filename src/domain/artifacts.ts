import type {
  ArtifactSignature,
  Controller,
  EvidenceArtifact,
  IssuerRole
} from "./types.js";
import { sha256 } from "../security/digest.js";

export type ArtifactEnvelope = Omit<EvidenceArtifact, "digest" | "signature">;
export type ArtifactSigner = (envelope: ArtifactEnvelope) => ArtifactSignature;

interface ArtifactInput {
  id: string;
  kind: string;
  capturedAt: string;
  issuerId: string;
  issuerRole: IssuerRole;
  controller: Controller;
  interactionId: string;
  content: unknown;
  expiresAt?: string;
  signer?: ArtifactSigner;
}

export function createArtifact(input: ArtifactInput): EvidenceArtifact {
  const envelope: ArtifactEnvelope = {
    id: input.id,
    kind: input.kind,
    capturedAt: input.capturedAt,
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    issuer: {
      id: input.issuerId,
      role: input.issuerRole,
      controller: input.controller
    },
    content: input.content,
    correlation: {
      interactionId: input.interactionId
    }
  };
  const signature = input.signer?.(envelope);
  return {
    ...envelope,
    digest: {
      algorithm: "sha256",
      value: sha256(envelope)
    },
    ...(signature === undefined ? {} : { signature })
  };
}

export function artifactEnvelope(artifact: EvidenceArtifact): ArtifactEnvelope {
  return {
    id: artifact.id,
    kind: artifact.kind,
    capturedAt: artifact.capturedAt,
    ...(artifact.expiresAt === undefined ? {} : { expiresAt: artifact.expiresAt }),
    issuer: artifact.issuer,
    content: artifact.content,
    correlation: artifact.correlation
  };
}

export function findArtifact(
  artifacts: EvidenceArtifact[],
  id: unknown,
  fallbackKind?: string
): EvidenceArtifact | undefined {
  if (typeof id === "string") {
    return artifacts.find(
      artifact => artifact.id === id && (fallbackKind === undefined || artifact.kind === fallbackKind)
    );
  }
  if (fallbackKind === undefined) {
    return undefined;
  }
  const matches = artifacts.filter(artifact => artifact.kind === fallbackKind);
  return matches.length === 1 ? matches[0] : undefined;
}
