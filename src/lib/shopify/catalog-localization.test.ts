import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buyerCatalogLocalizationFromProfile,
  buyerCatalogContextFromSources,
  catalogLocalizationFromProfile,
  profileWithAddressFallback,
  resolveCatalogLocalization,
  resolveEffectiveCatalogLocalization,
} from "./catalog-localization";

describe("resolveCatalogLocalization", () => {
  it("normalizes a country label to the same ISO code for both UCP fields", () => {
    const loc = resolveCatalogLocalization("Lebanon", null);
    assert.equal(loc.shipsTo, "LB");
    assert.equal(loc.addressCountry, "LB");
    assert.equal(loc.countryCode, "LB");
  });

  it("prefers shippingCountry over country", () => {
    const loc = resolveCatalogLocalization("United States", "Lebanon");
    assert.equal(loc.shipsTo, "US");
    assert.equal(loc.addressCountry, "US");
  });

  it("returns empty when no profile country", () => {
    const loc = resolveCatalogLocalization(null, null);
    assert.equal(loc.shipsTo, null);
    assert.equal(loc.addressCountry, null);
  });
});

describe("buyerCatalogLocalizationFromProfile", () => {
  it("always sends currency in catalog.context", () => {
    const { context } = buyerCatalogLocalizationFromProfile({
      shippingCountry: "Lebanon",
      currency: null,
    });
    assert.equal(context?.address_country, "LB");
    assert.equal(context?.currency, "LBP");
  });

  it("prefers profile currency over country hint", () => {
    const { context } = buyerCatalogLocalizationFromProfile({
      shippingCountry: "United States",
      currency: "eur",
    });
    assert.equal(context?.currency, "EUR");
  });

  it("defaults to USD when country is unknown", () => {
    const { context } = buyerCatalogLocalizationFromProfile({
      shippingCountry: null,
      country: null,
      currency: null,
    });
    assert.equal(context?.currency, "USD");
    assert.equal(context?.address_country, undefined);
  });
});

describe("catalogLocalizationFromProfile", () => {
  it("includes stored currency for settings UI", () => {
    const loc = catalogLocalizationFromProfile({
      shippingCountry: "France",
      currency: "EUR",
    });
    assert.equal(loc.countryLabel, "France");
    assert.equal(loc.currency, "EUR");
  });
});

describe("resolveEffectiveCatalogLocalization", () => {
  it("prefers conversation override over profile default", () => {
    const effective = resolveEffectiveCatalogLocalization(
      { shippingCountry: "United States", currency: "USD" },
      { shippingCountry: "Lebanon", currency: "LBP" },
    );
    assert.equal(effective.shipsTo, "LB");
    assert.equal(effective.currency, "LBP");
  });

  it("falls back to profile when conversation locale is empty", () => {
    const effective = resolveEffectiveCatalogLocalization(
      { shippingCountry: "United States", currency: "USD" },
      { shippingCountry: null, currency: null },
    );
    assert.equal(effective.shipsTo, "US");
    assert.equal(effective.currency, "USD");
  });
});

describe("profileWithAddressFallback", () => {
  it("uses saved address country when profile ship-to is unset", () => {
    const merged = profileWithAddressFallback(
      { shippingCountry: null, country: null },
      { addressCountry: "LB", addressRegion: "Beirut", postalCode: "1107" },
    );
    assert.equal(merged.shippingCountry, "Lebanon");
  });

  it("does not override an explicit profile ship-to", () => {
    const merged = profileWithAddressFallback(
      { shippingCountry: "United States", country: null },
      { addressCountry: "LB" },
    );
    assert.equal(merged.shippingCountry, "United States");
  });
});

describe("buyerCatalogContextFromSources", () => {
  it("localizes catalog calls from default saved address", () => {
    const { shipsToCountry, context } = buyerCatalogContextFromSources(
      { shippingCountry: null, country: null, currency: null },
      null,
      { addressCountry: "LB", addressRegion: "Beirut", postalCode: "1107" },
    );
    assert.equal(shipsToCountry, "LB");
    assert.equal(context.address_country, "LB");
    assert.equal(context.address_region, "Beirut");
    assert.equal(context.postal_code, "1107");
    assert.equal(context.currency, "LBP");
  });
});

describe("buildCatalogCallContext", () => {
  it("merges buyer currency with ships_to address fields", async () => {
    const { buildCatalogCallContext } = await import("./catalog");
    const ctx = buildCatalogCallContext(
      { ships_to: { country: "US", region: "CA" } },
      { currency: "USD", language: "en" },
      "birthday gift",
    );
    assert.equal(ctx?.address_country, "US");
    assert.equal(ctx?.address_region, "CA");
    assert.equal(ctx?.currency, "USD");
    assert.equal(ctx?.intent, "birthday gift");
  });
});
