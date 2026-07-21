/**
 * Deterministic JSON serialization for lab digests.
 *
 * This is intentionally a small stable-key serializer, not a claim of full
 * RFC 8785/JCS compliance. Inputs must already be JSON-compatible values.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

    return Object.fromEntries(entries.map(([key, entryValue]) => [key, sortValue(entryValue)]));
  }

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }

  throw new TypeError(`Value of type ${typeof value} is not JSON-compatible.`);
}
