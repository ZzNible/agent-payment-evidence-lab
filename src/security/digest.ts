import { createHash } from "node:crypto";

import { canonicalJson } from "./canonical-json.js";

export function sha256(value: unknown): string {
  const hex = createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
  return `sha256:${hex}`;
}

export function safeDigestEqual(left: string, right: string): boolean {
  return left === right && /^sha256:[a-f0-9]{64}$/u.test(left);
}
