import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { diffDump } from "./match";
import type { MemoryCase, StoreDump } from "./types";

const emptyDump = (overrides: Partial<StoreDump>): StoreDump => ({
  people: [{ id: "self", relation: "self", name: null }],
  facts: [],
  signals: [],
  request_events: [],
  ambiguous_subjects: 0,
  next_router_asks: [],
  recent_picks_line: null,
  watermark: null,
  ...overrides,
});

describe("wrong-person across fact types", () => {
  it("flags brother measurement 42 when son shoe size 42 was expected", () => {
    const cse: MemoryCase = {
      id: "x",
      seed: { people: [{ relation: "self" }] },
      turns: [],
      expect: {
        people: [
          { relation: "self" },
          { relation: "brother", name: "Gabriel" },
          { relation: "son", name: "Gabriel" },
        ],
        facts: [
          {
            person: "son (Gabriel)",
            fact_type: "size",
            garment_type: "shoes",
            value: { system: "eu", value: 42 },
            status: "active",
          },
        ],
        signals: [],
        forbidden: [],
      },
    };
    const dump = emptyDump({
      people: [
        { id: "s", relation: "self", name: null },
        { id: "b", relation: "brother", name: "Gabriel" },
        { id: "n", relation: "son", name: "Gabriel" },
      ],
      facts: [
        {
          person_id: "b",
          person: "brother (Gabriel)",
          fact_type: "measurement",
          garment_type: "waist",
          value: { metric: "waist", value: 42, unit: "cm" },
          status: "active",
        },
      ],
    });
    const diff = diffDump({ cse, dump });
    assert.equal(diff.wrong_person.length, 1);
    assert.match(diff.wrong_person[0]!, /brother \(Gabriel\)/);
  });

  it("does not treat alpha in JSON as a forbidden L or M", () => {
    const cse: MemoryCase = {
      id: "iso",
      seed: { people: [{ relation: "self" }] },
      turns: [],
      expect: {
        people: [{ relation: "self" }, { relation: "brother" }],
        facts: [
          {
            person: "self",
            fact_type: "size",
            garment_type: "tops",
            value: { system: "alpha", value: "M" },
            status: "active",
          },
          {
            person: "brother",
            fact_type: "size",
            garment_type: "tops",
            value: { system: "alpha", value: "L" },
            status: "active",
          },
        ],
        signals: [],
        forbidden: [
          { person: "self", fact_type: "size", value: "L" },
          { person: "brother", fact_type: "size", value: "M" },
        ],
      },
    };
    const dump = emptyDump({
      people: [
        { id: "s", relation: "self", name: null },
        { id: "b", relation: "brother", name: null },
      ],
      facts: [
        {
          person_id: "s",
          person: "self",
          fact_type: "size",
          garment_type: "tops",
          value: { system: "alpha", value: "M" },
          status: "active",
        },
        {
          person_id: "b",
          person: "brother",
          fact_type: "size",
          garment_type: "tops",
          value: { system: "alpha", value: "L" },
          status: "active",
        },
      ],
    });
    const diff = diffDump({ cse, dump });
    assert.deepEqual(diff.forbidden, []);
    assert.equal(diff.missing.length, 0);
  });
});

describe("next_router_asks chips", () => {
  it("passes when dump chips include the expected labels", () => {
    const cse: MemoryCase = {
      id: "id-03",
      seed: { people: [{ relation: "self" }] },
      turns: [],
      expect: {
        people: [{ relation: "self" }],
        facts: [],
        signals: [],
        forbidden: [],
        next_router_asks: [
          {
            gap: "recipient",
            chips_include: ["friend (Sam)", "colleague (Sam)"],
          },
        ],
      },
    };
    const dump = emptyDump({
      next_router_asks: [
        {
          gap: "recipient",
          chips: ["friend (Sam)", "colleague (Sam)", "Other"],
        },
      ],
    });
    const diff = diffDump({ cse, dump });
    assert.deepEqual(diff.next_router_asks, []);
  });
});
