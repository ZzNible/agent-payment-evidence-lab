import { describe, expect, it } from "vitest";

import {
  createEd25519Identity,
  signJson,
  verifyJsonSignature
} from "../../src/security/signatures.js";

describe("Ed25519 JSON signatures", () => {
  it("verifies semantically identical objects regardless of key insertion order", () => {
    const identity = createEd25519Identity();
    const signature = signJson({ z: 2, a: { y: 1, x: true } }, identity);

    expect(verifyJsonSignature({ a: { x: true, y: 1 }, z: 2 }, signature)).toBe(true);
  });

  it("rejects content changed after signing", () => {
    const identity = createEd25519Identity();
    const signature = signJson({ job_status: "completed" }, identity);

    expect(verifyJsonSignature({ job_status: "failed" }, signature)).toBe(false);
  });

  it("rejects a signature made by a different identity", () => {
    const signer = createEd25519Identity();
    const other = createEd25519Identity();
    const content = { job_status: "completed" };
    const signature = signJson(content, signer);
    const otherSignature = signJson(content, other);

    expect(
      verifyJsonSignature(content, { ...signature, value: otherSignature.value })
    ).toBe(false);
  });

  it("fails closed for malformed key and signature encodings", () => {
    const identity = createEd25519Identity();
    const signature = signJson({ statement: true }, identity);

    expect(
      verifyJsonSignature(
        { statement: true },
        { ...signature, publicKey: "not-a-der-public-key", value: "not-a-signature" }
      )
    ).toBe(false);
  });
});

