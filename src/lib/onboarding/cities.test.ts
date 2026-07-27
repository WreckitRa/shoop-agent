import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  citiesForCountryLabel,
  cityOptionsForCountry,
  countryCodeFromLabel,
} from "./cities";

describe("countryCodeFromLabel", () => {
  it("resolves Shopify display labels to ISO codes", () => {
    assert.equal(countryCodeFromLabel("United States"), "US");
    assert.equal(countryCodeFromLabel("United Kingdom"), "GB");
    assert.equal(countryCodeFromLabel(""), null);
  });
});

describe("citiesForCountryLabel", () => {
  it("returns major cities for supported countries", () => {
    const us = citiesForCountryLabel("United States");
    assert.ok(us.includes("New York"));
    assert.ok(us.includes("Los Angeles"));

    const lb = citiesForCountryLabel("Lebanon");
    assert.ok(lb.includes("Beirut"));
  });

  it("returns empty for unknown or unsupported countries", () => {
    assert.deepEqual(citiesForCountryLabel(""), []);
    assert.deepEqual(citiesForCountryLabel("Not A Real Country"), []);
  });
});

describe("cityOptionsForCountry", () => {
  it("maps cities to select options", () => {
    const opts = cityOptionsForCountry("Singapore");
    assert.deepEqual(opts, [{ value: "Singapore", label: "Singapore" }]);
  });
});
