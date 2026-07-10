import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseMaterialMentions } from "./material-parser";

type Case = {
  text: string;
  expect: Array<{
    material: string;
    polarity: "present" | "absent" | "faux";
    percentage?: number;
  }>;
};

const CASES: Case[] = [
  {
    text: "100% Polyester Track Jacket",
    expect: [{ material: "polyester", polarity: "present", percentage: 100 }],
  },
  {
    text: "Non-polyester performance tee",
    expect: [{ material: "polyester", polarity: "absent" }],
  },
  {
    text: "Polyester-free linen shirt",
    expect: [
      { material: "polyester", polarity: "absent" },
      { material: "linen", polarity: "present" },
    ],
  },
  {
    text: "Cotton shirt (5% elastane)",
    expect: [
      { material: "cotton", polarity: "present" },
      { material: "elastane", polarity: "present", percentage: 5 },
    ],
  },
  {
    text: "60% cotton 40% polyester",
    expect: [
      { material: "cotton", polarity: "present", percentage: 60 },
      { material: "polyester", polarity: "present", percentage: 40 },
    ],
  },
  {
    text: "Vegan leather jacket",
    expect: [{ material: "leather", polarity: "faux" }],
  },
  {
    text: "Faux fur hooded parka",
    expect: [{ material: "fur", polarity: "faux" }],
  },
  {
    text: "Cotton candy pink hoodie",
    expect: [],
  },
  {
    text: "Silky smooth modal tee",
    expect: [{ material: "modal", polarity: "present" }],
  },
  {
    text: "Laine mérinos",
    expect: [{ material: "merino", polarity: "present" }],
  },
];

describe("parseMaterialMentions", () => {
  for (const c of CASES) {
    it(c.text, () => {
      const mentions = parseMaterialMentions(c.text);
      for (const expected of c.expect) {
        const hit = mentions.find(
          (m) =>
            m.material === expected.material &&
            m.polarity === expected.polarity &&
            (expected.percentage == null || m.percentage === expected.percentage),
        );
        assert.ok(hit, `expected ${JSON.stringify(expected)} in ${JSON.stringify(mentions)}`);
      }
      if (!c.expect.length) {
        assert.equal(mentions.filter((m) => m.polarity === "present").length, 0);
      }
    });
  }
});
