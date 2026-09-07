import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  displayHexForFamily,
  isLegacySilentFallback,
  parseHexOrNull,
} from "./family-hex";

describe("family hex", () => {
  it("refuses garbage hex", () => {
    assert.equal(parseHexOrNull("#254A3B},{"), null);
    assert.equal(parseHexOrNull("#596044},{"), null);
  });

  it("re-derives Ray's silent camel fallback from family", () => {
    const camel = `#${(0xb8894f).toString(16).padStart(6, "0").toUpperCase()}`;
    assert.equal(isLegacySilentFallback("green", camel), true);
    assert.equal(isLegacySilentFallback("olive", camel), true);
    assert.equal(isLegacySilentFallback("beige", camel), false);
    assert.equal(displayHexForFamily("green"), "#254A3B");
    assert.equal(displayHexForFamily("olive"), "#596044");
  });
});
