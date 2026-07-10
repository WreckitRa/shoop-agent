import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  dedupeCanonicalMemories,
  filterStaleIntents,
  filterNonemptyRecipients,
} from "./memory-hygiene";

describe("memory hygiene", () => {
  it("dedupes exact-duplicate canonical memories", () => {
    const rows = [
      { value: "Gift for aunt: candle set", scope: "global" },
      { value: "Gift for aunt: candle set", scope: "session" },
    ] as never[];
    assert.equal(dedupeCanonicalMemories(rows).length, 1);
  });

  it("filters stale intents past neededBy", () => {
    const past = new Date("2025-01-01");
    const rows = [{ intentName: "wife birthday", neededBy: past, status: "active" }];
    assert.equal(filterStaleIntents(rows).length, 0);
  });

  it("drops empty recipient shells", () => {
    const rows = [
      { label: "sister-in-law", name: null, knownPreferences: [], dislikes: [], favoriteBrands: [], sizes: null },
      { label: "wife", name: "Sam", knownPreferences: ["hiking"], dislikes: [], favoriteBrands: [], sizes: null },
    ];
    assert.equal(filterNonemptyRecipients(rows).length, 1);
  });
});
