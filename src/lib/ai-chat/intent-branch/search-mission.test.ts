import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deriveBranchTitleFromQuery,
  fastPathSearchMissionDecision,
  searchMissionFromBrief,
} from "./search-mission";

describe("fastPathSearchMissionDecision", () => {
  it("does not split iPhone charger → case", () => {
    const prev = {
      query: "fast USB-C charger iPhone 17",
      category: "tech",
      recipientKind: "self" as const,
    };
    const curr = {
      query: "iPhone 17 Pro Max case under $40",
      category: "tech",
      recipientKind: "self" as const,
    };
    const decision = fastPathSearchMissionDecision(prev, curr);
    assert.ok(decision);
    assert.equal(decision.split, false);
  });

  it("splits gift fashion → utility knife via disjoint categories", () => {
    const prev = searchMissionFromBrief({
      archetype: "gift_directed",
      query: "vintage retro minimalist women's t-shirt",
      mustHaves: [],
      niceToHaves: [],
      budget: { amountCents: 8000, type: "soft", currency: "USD" },
      variantConstraints: {},
      genderScope: "womens",
      recipient: { kind: "other", label: "sister-in-law" },
      rankingProfile: "gift_diversity",
      directionLabel: "Retro Minimalist",
    });
    const curr = {
      query: "utility knife camping",
      recipientKind: "self" as const,
    };
    const decision = fastPathSearchMissionDecision(prev, curr);
    assert.ok(decision);
    assert.equal(decision.split, true);
  });

  it("splits gift recipient → self shopping", () => {
    const prev = {
      query: "gift t-shirt sister-in-law",
      recipientKind: "other" as const,
      recipientLabel: "sister-in-law",
    };
    const curr = {
      query: "black relaxed pants daily wear",
      recipientKind: "self" as const,
    };
    const decision = fastPathSearchMissionDecision(prev, curr);
    assert.ok(decision);
    assert.equal(decision.split, true);
    assert.equal(decision.reason, "gift_recipient_to_self");
  });
});

describe("deriveBranchTitleFromQuery", () => {
  it("strips leading looking for", () => {
    assert.match(
      deriveBranchTitleFromQuery(
        "looking for a nice utility knife for camping",
      ),
      /utility knife/i,
    );
  });
});
