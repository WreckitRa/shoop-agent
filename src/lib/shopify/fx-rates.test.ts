import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { convertPriceCents, type FxRateTable } from "./fx-rates";

const TABLE: FxRateTable = {
  base: "USD",
  rates: { USD: 1, EUR: 0.9, GBP: 0.8, NPR: 133 },
  fetchedAt: Date.now(),
};

describe("convertPriceCents", () => {
  it("returns the same amount for identical currencies", () => {
    assert.equal(convertPriceCents(9900, "USD", "USD", TABLE), 9900);
  });

  it("converts USD to EUR via the USD-base table", () => {
    assert.equal(convertPriceCents(10000, "USD", "EUR", TABLE), 9000);
  });

  it("converts foreign presentment to buyer currency", () => {
    // 13,300 NPR-paisa = 133 NPR ≈ 1 USD ≈ 80 GBP-pence (same minor-unit axis).
    assert.equal(convertPriceCents(13300, "NPR", "GBP", TABLE), 80);
  });

  it("returns null when a currency is unknown", () => {
    assert.equal(convertPriceCents(5000, "XYZ", "USD", TABLE), null);
  });
});
