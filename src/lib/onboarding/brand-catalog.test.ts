import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyBrandTap,
  brandMarket,
  brandSlug,
  findSeedBrand,
  searchSeedBrands,
  selectBrandsForUser,
} from "./brand-catalog";
import { noListCardsFor } from "./no-list-cards";

describe("brand-catalog", () => {
  it("keeps womenswear houses off a menswear grid", () => {
    const brands = selectBrandsForUser({
      genderPresentation: "masculine",
      styleEra: "30s",
      lifestyleTags: ["deep_in_career"],
      valuePhilosophy: "premium",
      shippingCountry: "United Kingdom",
    });
    const names = brands.map((b) => b.name);
    for (const leak of ["Sézane", "Reformation", "Aritzia", "Madewell", "Ganni"]) {
      assert.ok(!names.includes(leak), `leaked ${leak}`);
    }
    assert.ok(brands.length >= 20, `expected a full grid, got ${brands.length}`);
  });

  it("keeps menswear houses off a womenswear grid", () => {
    const brands = selectBrandsForUser({
      genderPresentation: "feminine",
      styleEra: "30s",
      valuePhilosophy: "premium",
      lifestyleTags: ["deep_in_career"],
      shippingCountry: "United Kingdom",
    });
    const names = brands.map((b) => b.name);
    for (const leak of ["Drake's", "Charles Tyrwhitt", "Our Legacy"]) {
      assert.ok(!names.includes(leak), `leaked ${leak}`);
    }
  });

  it("still puts budget shops on a luxury grid", () => {
    const brands = selectBrandsForUser({
      genderPresentation: "feminine",
      valuePhilosophy: "luxury",
      shippingCountry: "United Kingdom",
    });
    const budget = brands.filter((b) => b.priceBand <= 2);
    assert.ok(budget.length >= 2, `expected budget spread, got ${brands.map((b) => b.name).join(", ")}`);
    assert.ok(new Set(brands.map((b) => b.priceBand)).size >= 3);
  });

  it("finds seed brands by common typings", () => {
    assert.equal(findSeedBrand("COS")?.name, "COS");
    assert.equal(findSeedBrand("h&m")?.name, "H&M");
    assert.equal(findSeedBrand("other stories")?.name, "& Other Stories");
    assert.ok(searchSeedBrands("zara").some((b) => b.name === "Zara"));
  });

  it("maps shipping country onto the csv market", () => {
    assert.equal(brandMarket("United Kingdom"), "uk");
    assert.equal(brandMarket("United Arab Emirates"), "mena");
    assert.equal(brandMarket("United States"), "us");
    assert.equal(brandMarket("France"), "eu");
  });

  it("cycles tap love → never → clear", () => {
    let likes: string[] = [];
    let avoids: string[] = [];
    ({ likes, avoids } = applyBrandTap(likes, avoids, "COS"));
    assert.deepEqual(likes, ["COS"]);
    assert.deepEqual(avoids, []);
    ({ likes, avoids } = applyBrandTap(likes, avoids, "COS"));
    assert.deepEqual(likes, []);
    assert.deepEqual(avoids, ["COS"]);
    ({ likes, avoids } = applyBrandTap(likes, avoids, "COS"));
    assert.deepEqual(likes, []);
    assert.deepEqual(avoids, []);
  });

  it("slugifies typed names stably", () => {
    assert.equal(brandSlug("Acne Studios"), "acne_studios");
    assert.equal(brandSlug("H&M"), "h_and_m");
  });
});

describe("no-list cards", () => {
  it("does not offer heels or sheer to a menswear shopper", () => {
    const cards = noListCardsFor({ genderPresentation: "masculine" });
    const ids = cards.map((c) => c.id);
    assert.ok(!ids.includes("heels"));
    assert.ok(!ids.includes("sheer"));
    assert.ok(ids.includes("skinny") || ids.includes("tight"));
  });

  it("does not offer skinny-jeans vetoes to a womenswear shopper", () => {
    const cards = noListCardsFor({ genderPresentation: "feminine" });
    const ids = cards.map((c) => c.id);
    assert.ok(ids.includes("heels"));
    assert.ok(!ids.includes("skinny"));
  });
});
