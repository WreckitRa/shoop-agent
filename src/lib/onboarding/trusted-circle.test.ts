import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeCircleNames } from "./trusted-circle";

describe("normalizeCircleNames", () => {
  it("trims, dedupes case-insensitively, and caps at 3", () => {
    assert.deepEqual(
      normalizeCircleNames([" Maya ", "jordan", "MAYA", "Sam", "Alex"]),
      ["Maya", "jordan", "Sam"],
    );
  });

  it("drops empties and non-strings", () => {
    assert.deepEqual(normalizeCircleNames(["", "  ", 12, null, "Jo"]), ["Jo"]);
  });
});
