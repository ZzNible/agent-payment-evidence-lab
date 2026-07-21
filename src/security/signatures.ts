import {
  generateKeyPairSync,
  sign as signBytes,
  verify as verifyBytes,
  type KeyObject
} from "node:crypto";

import type { ArtifactSignature } from "../domain/types.js";
import { canonicalJson } from "./canonical-json.js";

export interface Ed25519Identity {
  publicKey: KeyObject;
  privateKey: KeyObject;
}

export function createEd25519Identity(): Ed25519Identity {
  return generateKeyPairSync("ed25519");
}

export function exportPublicKey(identity: Ed25519Identity): string {
  return identity.publicKey.export({ type: "spki", format: "der" }).toString("base64");
}

export function signJson(value: unknown, identity: Ed25519Identity): ArtifactSignature {
  const bytes = Buffer.from(canonicalJson(value), "utf8");
  return {
    algorithm: "Ed25519",
    publicKey: exportPublicKey(identity),
    value: signBytes(null, bytes, identity.privateKey).toString("base64")
  };
}

export function verifyJsonSignature(value: unknown, signature: ArtifactSignature): boolean {
  if (signature.algorithm !== "Ed25519") {
    return false;
  }

  try {
    const publicKey = {
      key: Buffer.from(signature.publicKey, "base64"),
      type: "spki" as const,
      format: "der" as const
    };
    return verifyBytes(
      null,
      Buffer.from(canonicalJson(value), "utf8"),
      publicKey,
      Buffer.from(signature.value, "base64")
    );
  } catch {
    return false;
  }
}
