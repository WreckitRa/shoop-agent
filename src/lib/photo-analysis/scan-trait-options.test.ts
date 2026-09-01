import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canonicalScanLabel,
  kindHasColor,
  matchScanTrait,
  scanTraitKind,
} from "./scan-trait-options";

describe("scan trait options", () => {
  it("maps photo-analysis paths to kinds", () => {
    assert.equal(
      scanTraitKind("visible_profile.color.visible_skin_surface_tone"),
      "skin",
    );
    assert.equal(scanTraitKind("visible_profile.color.eye_color"), "eyes");
    assert.equal(scanTraitKind("visible_profile.color.hair_color"), "hair");
    assert.equal(scanTraitKind("visible_profile.face.primary_shape"), "face");
  });

  it("picks colour swatches from model prose", () => {
    assert.equal(
      matchScanTrait("skin", "medium olive with warm golden cast on the cheek")
        ?.label,
      "Olive",
    );
    assert.equal(
      matchScanTrait("eyes", "dark brown iris, even in this lighting")?.label,
      "Dark brown",
    );
    assert.equal(
      matchScanTrait("hair", "dark brown, almost black at the roots")?.label,
      "Dark brown",
    );
    assert.equal(kindHasColor("skin"), true);
    assert.equal(kindHasColor("face"), false);
  });

  it("maps chips from long text", () => {
    assert.equal(canonicalScanLabel("undertone", "warm / golden"), "Warm");
    assert.equal(canonicalScanLabel("contrast", "high facial contrast"), "High");
    assert.equal(canonicalScanLabel("face", "oval outline"), "Oval");
    assert.equal(
      canonicalScanLabel("facial_hair", "clean shaven, no visible beard"),
      "None",
    );
  });
});
