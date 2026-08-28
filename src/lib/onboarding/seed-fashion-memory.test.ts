import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseSizeValue } from "@/lib/fashion-memory/intake/parse-size-value";
import {
  classifyHardAvoid,
  mapOnboardingGender,
  sizeSeedsFromSizing,
} from "./seed-fashion-memory";

describe("mapOnboardingGender", () => {
  it("maps masculine/feminine to mens/womens", () => {
    assert.equal(mapOnboardingGender("masculine"), "mens");
    assert.equal(mapOnboardingGender("feminine"), "womens");
  });

  it("maps androgynous / nonbinary / prefer-not-to-say to mixed", () => {
    assert.equal(mapOnboardingGender("androgynous"), "mixed");
    assert.equal(mapOnboardingGender("nonbinary"), "mixed");
    assert.equal(mapOnboardingGender("prefer not to say"), "mixed");
  });
});

describe("parseSizeValue (onboarding)", () => {
  it("parses alpha and 3XL", () => {
    assert.deepEqual(parseSizeValue("M"), { system: "alpha", value: "M" });
    assert.deepEqual(parseSizeValue("Medium"), { system: "alpha", value: "M" });
    assert.deepEqual(parseSizeValue("3XL"), { system: "alpha", value: "XXXL" });
  });

  it("parses waist x inseam bottoms", () => {
    assert.deepEqual(parseSizeValue("32x32"), {
      system: "waist_inseam",
      value: { waist: 32, inseam: 32 },
    });
  });

  it("parses EU shoes", () => {
    assert.deepEqual(parseSizeValue("43"), { system: "eu", value: 43 });
  });
});

describe("sizeSeedsFromSizing", () => {
  it("emits tops, bottoms, shoes from sizing profile", () => {
    const seeds = sizeSeedsFromSizing({
      topUsualSize: "M",
      bottomUsualSize: "32x32",
      shoeEU: 43,
    });
    assert.deepEqual(
      seeds.map((s) => s.bucket),
      ["tops", "bottoms", "shoes"],
    );
    assert.equal(seeds[0]!.value.system, "alpha");
    assert.equal(seeds[1]!.value.system, "waist_inseam");
    assert.deepEqual(seeds[2]!.value, { system: "eu", value: 43 });
  });
});

describe("classifyHardAvoid", () => {
  it("classifies materials vs style", async () => {
    assert.deepEqual(await classifyHardAvoid("leather"), {
      kind: "material",
      value: "leather",
    });
    assert.deepEqual(await classifyHardAvoid("logo-heavy"), {
      kind: "style",
      value: "logos",
    });
    assert.deepEqual(await classifyHardAvoid("no heels"), {
      kind: "garment",
      value: "no heels",
    });
  });
});
