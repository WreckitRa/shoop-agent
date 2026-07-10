import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  anchorPortfolioQueryText,
  isAnchorBrandProduct,
} from "./brand-anchors";
import type { CatalogProductSummary } from "@/lib/shopify/catalog";

describe("brand anchors", () => {
  it("detects Calvin Klein as fashion anchor", () => {
    const p = {
      id: "1",
      title: "Calvin Klein Men's Slim Fit Blazer",
    } as CatalogProductSummary;
    assert.equal(isAnchorBrandProduct(p, "black men's blazer", "blazer"), true);
  });

  it("builds anchor portfolio query from brief", () => {
    const q = anchorPortfolioQueryText({
      query: "black blazer men's tailored",
      category: "blazer",
    });
    assert.ok(q);
    assert.match(q!, /calvin klein|j\.?crew|bonobos|theory/i);
  });
});
