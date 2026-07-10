import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveSizeDeterministic } from "./size";
import type { NormalizedSize, SizeCategory } from "./types";

function definedSize(size: NormalizedSize): NormalizedSize {
  return Object.fromEntries(
    Object.entries(size).filter(([, value]) => value !== undefined),
  ) as NormalizedSize;
}

type SizeCase = {
  label: string;
  category: SizeCategory;
  resolved: boolean;
  size: NormalizedSize;
};

const CASES: SizeCase[] = [
  {
    label: "m-38",
    category: "tops",
    resolved: true,
    size: { alpha: "M", numeric: 38, numeric_system: "ambiguous" },
  },
  {
    label: "40 - relaxed",
    category: "tops",
    resolved: true,
    size: { numeric: 40, numeric_system: "ambiguous", fit_modifier: "relaxed" },
  },
  {
    label: "W32/L30",
    category: "bottoms",
    resolved: true,
    size: { numeric: 32, numeric_system: "waist", inseam: 30 },
  },
  {
    label: "One Size",
    category: "general",
    resolved: true,
    size: { one_size: true },
  },
  {
    label: "42",
    category: "shoes",
    resolved: true,
    size: { numeric: 42, numeric_system: "eu" },
  },
  {
    label: "8",
    category: "shoes",
    resolved: true,
    size: { numeric: 8, numeric_system: "ambiguous" },
  },
  {
    label: "Medium",
    category: "tops",
    resolved: true,
    size: { alpha: "M" },
  },
  {
    label: "Taille 2",
    category: "tops",
    resolved: false,
    size: {},
  },
];

describe("resolveSizeDeterministic", () => {
  for (const c of CASES) {
    it(`(${c.label}, ${c.category})`, () => {
      const result = resolveSizeDeterministic(c.label, c.category);
      assert.equal(result.resolved, c.resolved);
      assert.deepEqual(definedSize(result.size), c.size);
    });
  }
});
