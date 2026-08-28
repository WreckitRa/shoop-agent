import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyNoGo,
  factValuesEqualNormalized,
  normalizeFactWrite,
  normalizeSizeValue,
  noGoGarmentKey,
} from "./normalize-fact-write";

describe("normalizeFactWrite", () => {
  it("maps Medium → M on tops", () => {
    const out = normalizeFactWrite({
      factType: "size",
      garmentType: "tops",
      value: "Medium",
    });
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.deepEqual(out.write, {
      garmentType: "tops",
      value: { system: "alpha", value: "M" },
    });
  });

  it("maps 42 → eu 42 on shoes", () => {
    const out = normalizeFactWrite({
      factType: "size",
      garmentType: "shoes",
      value: "42",
    });
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.deepEqual(out.write, {
      garmentType: "shoes",
      value: { system: "eu", value: 42 },
    });
  });

  it("maps shirt garment_type to tops family", () => {
    const out = normalizeFactWrite({
      factType: "size",
      garmentType: "shirt",
      value: { system: "alpha", value: "Medium" },
    });
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.write.garmentType, "tops");
    assert.deepEqual(out.write.value, { system: "alpha", value: "M" });
  });

  it("rejects size without a garment family", () => {
    const out = normalizeFactWrite({
      factType: "size",
      value: {},
    });
    assert.equal(out.ok, false);
    if (out.ok) return;
    assert.equal(out.reason, "size_garment_type_required");
  });

  it("defaults alpha sizes without family to tops", () => {
    const out = normalizeFactWrite({
      factType: "size",
      value: "Medium",
    });
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.deepEqual(out.write, {
      garmentType: "tops",
      value: { system: "alpha", value: "M" },
    });
  });

  it("reads {size, category} clerk payloads", () => {
    const out = normalizeFactWrite({
      factType: "size",
      value: { size: "Medium", category: "top" },
    });
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.deepEqual(out.write, {
      garmentType: "tops",
      value: { system: "alpha", value: "M" },
    });
  });

  it("reads {size: L} on a tops reverse", () => {
    const out = normalizeFactWrite({
      factType: "size",
      garmentType: "tops",
      value: { size: "L" },
    });
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.deepEqual(out.write.value, { system: "alpha", value: "L" });
  });

  it("coerces {material: polyester} no_go", () => {
    const out = normalizeFactWrite({
      factType: "no_go",
      value: { material: "polyester" },
    });
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.write.garmentType, "nogo-material-polyester");
    assert.deepEqual(out.write.value, { kind: "material", value: "polyester" });
  });

  it("slugs no_go polyester", () => {
    const out = normalizeFactWrite({
      factType: "no_go",
      value: { kind: "material", value: "polyester" },
    });
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.write.garmentType, "nogo-material-polyester");
    assert.deepEqual(out.write.value, { kind: "material", value: "polyester" });
  });

  it("forces measurement garment_type to the metric", () => {
    const out = normalizeFactWrite({
      factType: "measurement",
      garmentType: "waist-cm",
      value: { metric: "waist", value: 84, unit: "cm" },
    });
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.write.garmentType, "waist");
  });

  it("normalizes depth_default", () => {
    const out = normalizeFactWrite({
      factType: "depth_default",
      value: { count: "5", unit: "options" },
    });
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.deepEqual(out.write.value, { count: 5, unit: "options" });
  });

  it("compares size old_value by normalized shape", () => {
    assert.equal(
      factValuesEqualNormalized({
        factType: "size",
        garmentType: "tops",
        a: { system: "alpha", value: "M" },
        b: "Medium",
      }),
      true,
    );
  });
});

describe("normalizeSizeValue / classifyNoGo", () => {
  it("Medium without family still maps to M", () => {
    assert.deepEqual(normalizeSizeValue("Medium", null), {
      system: "alpha",
      value: "M",
    });
  });

  it("classifies polyester as material and slugs it", () => {
    assert.deepEqual(classifyNoGo("polyester"), {
      kind: "material",
      value: "polyester",
    });
    assert.equal(
      noGoGarmentKey("material", "polyester"),
      "nogo-material-polyester",
    );
  });
});
