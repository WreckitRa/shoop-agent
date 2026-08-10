import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { paletteFallbackForLabel } from "./clarification-palette-fallback";

describe("clarification palette fallbacks", () => {
  it("keeps Neutral tones and Dark colors visually distinct", () => {
    const neutrals = paletteFallbackForLabel("Neutral tones");
    const dark = paletteFallbackForLabel("Dark colors");
    assert.equal(neutrals.length, 4);
    assert.equal(dark.length, 4);
    assert.notDeepEqual(neutrals, dark);
    assert.notEqual(neutrals[0], dark[0]);
  });

  it("maps common fashion palette labels", () => {
    assert.match(paletteFallbackForLabel("Earth tones")[0]!, /^#/);
    assert.match(paletteFallbackForLabel("Cool blues")[0]!, /^#/);
    assert.match(paletteFallbackForLabel("Bold colors")[0]!, /^#/);
  });
});
