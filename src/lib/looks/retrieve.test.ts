import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { taxonomyCategoriesForGarment } from "@/lib/fashion-memory/catalog-search/garment-taxonomy";
import type { CatalogProductSummary } from "@/lib/shopify/catalog";
import type { ContractPiece } from "@/lib/photo-analysis/style-contract";
import {
  prefilterCandidates,
  searchQueryFor,
  variantColorPass,
  vetoPass,
} from "./retrieve";
import { dropIfImageFamiliesMiss } from "./garment-image";
import { familyFromRgb } from "./image-color";

const knit: ContractPiece = {
  slot: "top",
  garment_type: "knit",
  color_family: "burgundy",
  shade: "muted wine",
  fallback_family: "red",
  fit: "regular",
  neckline: "crew",
  must_have: [],
  must_not: ["logo"],
};

function product(over: Partial<CatalogProductSummary> & { id: string; title: string }): CatalogProductSummary {
  return {
    media: [{ url: "https://example.com/x.jpg" }],
    ...over,
  };
}

describe("looks retrieve gates", () => {
  it("keeps query to shade + garment only", () => {
    const q = searchQueryFor(knit);
    assert.equal(q, "muted wine knit");
    assert.ok(q.split(/\s+/).length <= 5);
  });

  it("wine knit taxonomy is sweaters, never shorts", () => {
    const gids = taxonomyCategoriesForGarment("knit");
    const shorts = taxonomyCategoriesForGarment("shorts");
    assert.ok(gids.length);
    assert.ok(!gids.some((id) => shorts.includes(id)));
  });

  it("sweatshirt is not the hoodie GID", () => {
    const sweat = taxonomyCategoriesForGarment("sweatshirt");
    const hoodie = taxonomyCategoriesForGarment("hoodie");
    assert.ok(sweat.length && hoodie.length);
    assert.notEqual(sweat[0], hoodie[0]);
  });

  it("drops a Color option that buckets outside the piece family", () => {
    const hit = product({
      id: "p1",
      title: "Sotheby's Unisex Crewneck -- Navy",
      options: [{ name: "Color", values: [{ label: "Cream" }] }],
    });
    const pass = variantColorPass(hit, "navy");
    assert.equal(pass.ok, false);
  });

  it("keeps a Color option that buckets into the family", () => {
    const hit = product({
      id: "p2",
      title: "Crewneck",
      options: [{ name: "Color", values: [{ label: "Abyss Navy" }] }],
    });
    const pass = variantColorPass(hit, "navy");
    assert.equal(pass.ok, true);
    assert.equal(pass.matchedLabel, "Abyss Navy");
  });

  it("never sends shorts to a knit judge bench", () => {
    const shortsGid = taxonomyCategoriesForGarment("shorts")[0]!;
    const knitGids = taxonomyCategoriesForGarment("knit");
    const hits = [
      product({
        id: "shorts",
        title: "Volley Short",
        categories: [shortsGid],
      }),
      product({
        id: "knit-ok",
        title: "Wine Knit",
        categories: knitGids,
        options: [{ name: "Color", values: [{ label: "Burgundy" }] }],
      }),
    ];
    const survivors = prefilterCandidates(hits, knit, knitGids, new Set(["knit-ok"]), {});
    assert.equal(survivors.length, 1);
    assert.equal(survivors[0]?.product.id, "knit-ok");
  });

  it("vetoes logo in title", () => {
    const hit = product({ id: "logo", title: "Sotheby's logo crewneck" });
    assert.equal(vetoPass(hit, knit, {}), false);
  });
});

describe("variant image colour", () => {
  it("drops a cream image when the piece is navy", () => {
    const fam = familyFromRgb({ r: 232, g: 220, b: 198 });
    assert.ok(fam === "beige" || fam === "white");
    assert.equal(dropIfImageFamiliesMiss([fam], "navy"), true);
  });

  it("keeps a navy image for a navy piece", () => {
    assert.equal(familyFromRgb({ r: 23, g: 36, b: 58 }), "navy");
    assert.equal(dropIfImageFamiliesMiss(["navy"], "navy"), false);
  });
});
