import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isOpaqueLookId,
  moodboardDisplayTitle,
} from "./moodboard-title";

describe("moodboardDisplayTitle", () => {
  it("never surfaces fitting-room look ids", () => {
    assert.equal(isOpaqueLookId("fitting-room:dress_1_6"), true);
    assert.equal(
      moodboardDisplayTitle({
        kind: "look",
        lookId: "fitting-room:dress_1_6",
      }),
      "Saved look",
    );
  });

  it("prefers stored product titles", () => {
    assert.equal(
      moodboardDisplayTitle({
        kind: "look",
        lookId: "fitting-room:a|b",
        inputRefs: { titles: ["Silk slip dress", "Cashmere cardigan"] },
      }),
      "Silk slip dress · Cashmere cardigan",
    );
    assert.equal(
      moodboardDisplayTitle({
        kind: "item",
        inputRefs: { title: "Navy blazer" },
      }),
      "Navy blazer",
    );
  });

  it("keeps human curated look names", () => {
    assert.equal(
      moodboardDisplayTitle({ kind: "look", lookId: "Office Soft" }),
      "Office Soft",
    );
  });
});
