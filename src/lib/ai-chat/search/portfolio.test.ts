import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSearchBrief } from "./archetype";
import {
  learnedAngleQueries,
  mergePortfolio,
} from "./portfolio";
import { learnedAnglesScopeKey } from "./learning";
import type { PortfolioQuery } from "./types";

describe("mergePortfolio", () => {
  const mk = (text: string, isDiscovery = false): PortfolioQuery => ({
    id: text,
    text,
    wave: 2,
    isDiscovery,
  });

  it("dedupes by text", () => {
    const merged = mergePortfolio(
      [mk("running shoes")],
      [mk("running shoes"), mk("road trainers")],
      "broad",
    );
    assert.equal(merged.length, 2);
  });

  it("prioritizes planned queries over learned when capping", () => {
    const learned = [mk("passport wallet rfid"), mk("travel neck pillow")];
    const planned = [
      mk("organic bath salts eucalyptus"),
      mk("magnesium glycinate powder"),
      mk("jade facial roller gua sha"),
      mk("essential oil diffuser ceramic", true),
    ];
    const merged = mergePortfolio(learned, planned, "gift_directed", "Wellness");
    assert.equal(merged.length, 4);
    assert.ok(
      merged.every((q) => !q.text.includes("passport")),
      "learned travel queries must not displace planned wellness queries",
    );
    assert.ok(merged.some((q) => q.isDiscovery), "discovery query preserved");
  });

  it("uses learned only to backfill when the planner returns too few", () => {
    const learned = [mk("merino crewneck sweater")];
    const planned = [mk("wool cardigan button front")];
    const merged = mergePortfolio(learned, planned, "broad");
    assert.equal(merged.length, 2);
    assert.equal(merged[0]!.text, "wool cardigan button front");
    assert.equal(merged[1]!.text, "merino crewneck sweater");
  });

  it("caps to the archetype budget but preserves a discovery query", () => {
    const learned = [mk("a"), mk("b"), mk("c")];
    const planned = [mk("d"), mk("e"), mk("f"), mk("discovery", true)];
    const merged = mergePortfolio(learned, planned, "specific"); // max 3
    assert.equal(merged.length, 3);
    assert.ok(
      merged.some((q) => q.isDiscovery),
      "discovery query must survive the cap",
    );
    assert.ok(merged.every((q) => ["d", "e", "discovery"].includes(q.id)));
  });
});

describe("learnedAngleQueries", () => {
  it("wraps learned texts as wave-1 queries (max 3, deduped)", () => {
    const brief = buildSearchBrief({ query: "wool sweater" });
    const q = learnedAngleQueries(brief, [
      "merino crewneck",
      "merino crewneck",
      "lambswool jumper",
      "cashmere blend",
      "fourth angle",
    ]);
    assert.ok(q.length <= 3);
    assert.ok(q.every((x) => x.wave === 1));
  });
});

describe("learnedAnglesScopeKey", () => {
  it("requires direction_label for gift archetypes", () => {
    assert.equal(
      learnedAnglesScopeKey({
        archetype: "gift_directed",
        directionLabel: "Cozy Home Accents",
      }),
      "Cozy Home Accents",
    );
    assert.equal(
      learnedAnglesScopeKey({ archetype: "gift_directed" }),
      null,
    );
  });

  it("requires category for non-gift archetypes", () => {
    assert.equal(
      learnedAnglesScopeKey({ archetype: "broad", category: "running shoes" }),
      "running shoes",
    );
    assert.equal(learnedAnglesScopeKey({ archetype: "broad" }), null);
  });
});
