import { describe, expect, it } from "vitest";

import { canonicalJson } from "../../src/security/canonical-json.js";
import { safeDigestEqual, sha256 } from "../../src/security/digest.js";

describe("canonical JSON and digests", () => {
  it("sorts object keys recursively while preserving array order", () => {
    const left = {
      z: [{ b: 2, a: 1 }, "second"],
      a: { y: true, x: null }
    };
    const right = {
      a: { x: null, y: true },
      z: [{ a: 1, b: 2 }, "second"]
    };

    expect(canonicalJson(left)).toBe(
      '{"a":{"x":null,"y":true},"z":[{"a":1,"b":2},"second"]}'
    );
    expect(canonicalJson(right)).toBe(canonicalJson(left));
    expect(sha256(right)).toBe(sha256(left));
  });

  it("omits undefined object properties but does not reorder arrays", () => {
    expect(canonicalJson({ present: 1, omitted: undefined })).toBe('{"present":1}');
    expect(sha256(["a", "b"])).not.toBe(sha256(["b", "a"]));
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 1n, undefined])(
    "rejects non-JSON-compatible input %s",
    value => {
      expect(() => canonicalJson(value)).toThrow(TypeError);
    }
  );

  it("changes the digest when evidence content changes", () => {
    expect(sha256({ status: "completed" })).not.toBe(sha256({ status: "failed" }));
  });

  it("only accepts equal, well-formed sha256 digests", () => {
    const digest = sha256({ stable: true });

    expect(safeDigestEqual(digest, digest)).toBe(true);
    expect(safeDigestEqual(digest, sha256({ stable: false }))).toBe(false);
    expect(safeDigestEqual("same", "same")).toBe(false);
    expect(safeDigestEqual("sha256:ABC", "sha256:ABC")).toBe(false);
  });
});

