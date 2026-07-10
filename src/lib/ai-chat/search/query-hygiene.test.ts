import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BANNED_IN_QUERY,
  queryContainsBannedToken,
  sanitizeQueryText,
  sanitizeSearchBrief,
  stripQueryTokens,
} from "./query-hygiene";
import { hasVariantConstraints } from "./verify";
import type { SearchBrief } from "./types";

describe("query hygiene", () => {
  it("strips banned gift/occasion tokens from queries", () => {
    const raw =
      "fitness sports gear accessories gift for young adult male birthday";
    const cleaned = stripQueryTokens(raw);
    for (const banned of BANNED_IN_QUERY) {
      assert.equal(queryContainsBannedToken(cleaned), false, banned);
    }
    assert.match(cleaned, /fitness|sports/i);
  });

  it("sanitizes to a concrete product phrase", () => {
    const q = sanitizeQueryText("wireless workout earbuds gift for him");
    assert.equal(queryContainsBannedToken(q), false);
    assert.ok(q.includes("wireless"));
  });

  it("strips gift compounds and single-noun products validate", () => {
    const q = sanitizeQueryText("gift headphones noise cancelling");
    assert.equal(queryContainsBannedToken(q), false);
    assert.equal(q, "headphones noise cancelling");
  });

  it("sanitizeSearchBrief coerces missing variantConstraints", () => {
    const raw = {
      archetype: "specific",
      query: "men's black work blazer",
      mustHaves: [],
      niceToHaves: [],
      budget: { amountCents: null, type: "none", currency: "USD" },
      genderScope: "mens",
      recipient: { kind: "self" },
      rankingProfile: "relevance_first",
    } as SearchBrief;
    delete (raw as { variantConstraints?: unknown }).variantConstraints;

    const brief = sanitizeSearchBrief(raw);
    assert.deepEqual(brief.variantConstraints, {});
    assert.doesNotThrow(() => hasVariantConstraints(brief));
    assert.equal(Boolean(brief.variantConstraints?.size?.trim()), false);
  });

  it("sanitizeSearchBrief coerces missing budget", () => {
    const raw = {
      archetype: "specific",
      query: "men's black work blazer regular classic fit",
      mustHaves: [],
      niceToHaves: [],
      variantConstraints: {},
      genderScope: "mens",
      recipient: { kind: "self" },
      rankingProfile: "relevance_first",
    } as SearchBrief;
    delete (raw as { budget?: unknown }).budget;

    const brief = sanitizeSearchBrief(raw);
    assert.equal(brief.budget.type, "none");
    assert.equal(brief.budget.amountCents, null);
    assert.equal(brief.budget.currency, "USD");
    assert.doesNotThrow(() => brief.budget.amountCents);
  });
});
