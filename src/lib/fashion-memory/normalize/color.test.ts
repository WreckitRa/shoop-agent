import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveColorDeterministic } from "./color";

type ColorCase = {
  label: string;
  buckets: string[];
  resolved: boolean;
  via?: "fuzzy";
};

const CASES: ColorCase[] = [
  { label: "Noir/Black", buckets: ["black"], resolved: true },
  { label: "washed black", buckets: ["black"], resolved: true },
  { label: "Sand Beige", buckets: ["beige"], resolved: true },
  { label: "midnight blue", buckets: ["navy"], resolved: true },
  { label: "midnight", buckets: ["black"], resolved: true },
  { label: "Blk", buckets: [], resolved: false },
  { label: "chrcoal", buckets: ["grey"], resolved: true, via: "fuzzy" },
  { label: "blck", buckets: ["black"], resolved: true, via: "fuzzy" },
  { label: "black & white", buckets: ["black", "white"], resolved: true },
  { label: "floral print", buckets: ["print"], resolved: true },
  { label: "Bordeaux", buckets: ["burgundy"], resolved: true },
  { label: "qzxv", buckets: [], resolved: false },
];

describe("resolveColorDeterministic", () => {
  for (const c of CASES) {
    it(`${c.label} → ${c.resolved ? c.buckets.join(",") : "unresolved"}`, () => {
      const result = resolveColorDeterministic(c.label);
      assert.equal(result.resolved, c.resolved);
      assert.deepEqual(result.buckets, c.buckets);
      if (c.via === "fuzzy") {
        assert.equal(result.via, "fuzzy");
      }
    });
  }
});
