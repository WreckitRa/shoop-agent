import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  paletteFallbackForLabel,
  palettePlausibleForLabel,
} from "./clarification-palette-fallback";

describe("clarification palette plausibility", () => {
  it("rejects dark hexes for Neutral tones", () => {
    assert.equal(
      palettePlausibleForLabel("Neutral tones", [
        "#0f0f12",
        "#1f1f24",
        "#3a3a42",
        "#5c5c66",
      ]),
      false,
    );
  });

  it("rejects light hexes for Dark colors", () => {
    assert.equal(
      palettePlausibleForLabel("Dark colors", [
        "#f2f2ee",
        "#cfcfc9",
        "#8a8a93",
        "#a8a29e",
      ]),
      false,
    );
  });

  it("fallback Neutral vs Dark are distinct and plausible", () => {
    const n = paletteFallbackForLabel("Neutral tones");
    const d = paletteFallbackForLabel("Dark colors");
    assert.ok(palettePlausibleForLabel("Neutral tones", n));
    assert.ok(palettePlausibleForLabel("Dark colors", d));
    assert.notDeepEqual(n, d);
  });
});
