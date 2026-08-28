import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeSignalContext } from "./signal-context";

describe("normalizeSignalContext", () => {
  it("keeps known contexts and occasion families", () => {
    assert.equal(normalizeSignalContext("gym"), "gym");
    assert.equal(normalizeSignalContext("work_consultant"), "work");
  });

  it("collapses free inventions to general", () => {
    assert.equal(
      normalizeSignalContext("general preference shift"),
      "general",
    );
  });
});
