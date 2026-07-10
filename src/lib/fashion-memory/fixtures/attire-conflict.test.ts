import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectAttireConflictTitle,
  titleTokensPreservingCompounds,
} from "../scoring/attire-conflict";

describe("vneck_tee_penalized_in_blazer_slot", () => {
  it("flags a v-neck tee title in a blazer slot", () => {
    const suspicion = detectAttireConflictTitle({
      title: "BYLT Soft Air V-Neck T-Shirt Black",
      garment: "blazer",
    });
    assert.ok(suspicion);
    assert.equal(suspicion!.rule, "attire_conflict_title");
    assert.match(suspicion!.evidence, /t-shirt/i);
  });
});

describe("dress_shirt_not_selfpenalized", () => {
  it("does not flag when the slot's own garment noun is present", () => {
    const suspicion = detectAttireConflictTitle({
      title: "Mens Oxford Dress Shirt White Cotton",
      garment: "dress shirt",
    });
    assert.equal(suspicion, null);
  });

  it("keeps hyphenated t-shirt as one token so shirt does not fire inside it", () => {
    const tokens = titleTokensPreservingCompounds("Soft Air V-Neck T-Shirt");
    assert.ok(tokens.includes("t-shirt"));
    assert.equal(tokens.includes("shirt"), false);
  });
});
