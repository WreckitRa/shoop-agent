import type { MemoryCase, MemoryPersonRef } from "./types";

const self: MemoryPersonRef = { relation: "self" };
const size = (value: string, system: "alpha" | "eu" | "us" = "alpha") =>
  system === "alpha"
    ? { system, value: value.toUpperCase() === "MEDIUM" ? "M" : value }
    : { system, value: Number(value) };

function cse(
  id: string,
  rest: Omit<MemoryCase, "id">,
): MemoryCase {
  return { id, ...rest };
}

export const MEMORY_CASES: MemoryCase[] = [
  cse("iso-01", {
    seed: { people: [self, { relation: "brother" }] },
    turns: [{ user: "He's an L and I'm an M" }],
    expect: {
      people: [self, { relation: "brother" }],
      facts: [
        {
          person: "self",
          fact_type: "size",
          garment_type: "tops",
          value: size("M"),
          status: "active",
        },
        {
          person: "brother",
          fact_type: "size",
          garment_type: "tops",
          value: size("L"),
          status: "active",
        },
      ],
      signals: [],
      forbidden: [
        { person: "self", fact_type: "size", value: "L" },
        { person: "brother", fact_type: "size", value: "M" },
      ],
    },
  }),

  cse("iso-02", {
    seed: { people: [self, { relation: "mother" }] },
    turns: [
      { user: "I need a blouse for my mother" },
      {
        assistant_ask: {
          recipient: "mother",
          questions: [
            {
              gap: "size",
              text: "What's her typical top size?",
              garment_type: "tops",
              field: "size_tops",
            },
          ],
        },
      },
      { chip_tap: "M" },
    ],
    expect: {
      people: [self, { relation: "mother" }],
      facts: [
        {
          person: "mother",
          fact_type: "size",
          garment_type: "tops",
          value: size("M"),
          status: "active",
        },
      ],
      signals: [],
      forbidden: [{ person: "self", fact_type: "size" }],
    },
  }),

  cse("iso-03", {
    seed: { people: [self, { relation: "mother" }] },
    turns: [
      { user: "Find a navy dress for my mother" },
      {
        assistant_results: {
          garments: ["navy dress"],
          search_id: "iso-03",
          recipient: "mother",
          attributes: { color: "navy", garment: "dress" },
        },
      },
      {
        rail: {
          kind: "tier1_reject",
          search_id: "iso-03",
          ref: "p-navy",
          attrs: { color: "navy", style: "classic" },
        },
      },
    ],
    expect: {
      people: [self, { relation: "mother" }],
      facts: [],
      signals: [
        {
          person: "mother",
          signal_type: "color",
          value: "navy",
          polarity: -1,
          source: "rejection",
          status: "candidate",
          confidence: 0.3,
        },
      ],
      forbidden: [
        { person: "self", signal_type: "color", value: "navy" },
      ],
    },
  }),

  cse("iso-04", {
    seed: { people: [self, { relation: "mother" }] },
    turns: [
      { user: "Find a navy dress for my mother" },
      {
        assistant_results: {
          garments: ["navy dress"],
          search_id: "iso-04",
          recipient: "mother",
          attributes: { color: "navy" },
        },
      },
      {
        rail: {
          kind: "tier1_expand",
          search_id: "iso-04",
          ref: "p-navy",
          attrs: { color: "navy", style: "classic" },
        },
      },
    ],
    expect: {
      people: [self, { relation: "mother" }],
      facts: [],
      signals: [
        {
          person: "self",
          signal_type: "color",
          value: "navy",
          polarity: 1,
          source: "inferred",
          status: "candidate",
        },
      ],
      forbidden: [
        { person: "mother", signal_type: "color", value: "navy" },
      ],
    },
  }),

  cse("id-01", {
    seed: { people: [self, { relation: "brother", name: "Gabriel" }] },
    turns: [{ user: "my son Gabriel needs shoes, 42" }],
    expect: {
      people: [
        self,
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
      forbidden: [{ person: "brother (Gabriel)", fact_type: "size" }],
    },
  }),

  cse("id-02", {
    seed: { people: [self, { relation: "mother" }] },
    turns: [
      { user: "for my mama" },
      { user: "pour ma mère" },
      { user: "لماما" },
      { user: "my ma" },
    ],
    expect: {
      people: [self, { relation: "mother" }],
      facts: [],
      signals: [],
      forbidden: [],
    },
  }),

  cse("id-03", {
    seed: {
      people: [
        self,
        { relation: "friend", name: "Sam" },
        { relation: "colleague", name: "Sam" },
      ],
    },
    turns: [{ user: "Sam likes navy" }],
    expect: {
      people: [
        self,
        { relation: "friend", name: "Sam" },
        { relation: "colleague", name: "Sam" },
      ],
      facts: [],
      signals: [],
      forbidden: [
        { person: "friend (Sam)", signal_type: "color", value: "navy" },
        { person: "colleague (Sam)", signal_type: "color", value: "navy" },
        { person: "self", signal_type: "color", value: "navy" },
      ],
      ambiguous_subjects: 1,
      next_router_asks: [
        { gap: "recipient", chips_include: ["friend (Sam)", "colleague (Sam)"] },
      ],
    },
  }),

  cse("id-04", {
    seed: { people: [self, { relation: "son" }] },
    turns: [{ user: "my son Leo needs a jacket" }],
    expect: {
      people: [self, { relation: "son", name: "Leo" }],
      facts: [],
      signals: [],
      forbidden: [],
    },
  }),

  cse("id-05", {
    seed: { people: [self] },
    turns: [{ user: "my old man wears XL" }],
    expect: {
      people: [self, { relation: "father" }],
      facts: [
        {
          person: "father",
          fact_type: "size",
          garment_type: "tops",
          value: size("XL"),
          status: "active",
        },
      ],
      signals: [],
      forbidden: [{ person: "self", fact_type: "size" }],
    },
  }),

  cse("id-06", {
    seed: { people: [self] },
    turns: [{ user: "for my sister's 8 year old, he loves green" }],
    expect: {
      people: [self, { relation: "nephew" }],
      facts: [
        {
          person: "nephew",
          fact_type: "gender_presentation",
          value: { presentation: "boys" },
          status: "active",
        },
      ],
      signals: [
        {
          person: "nephew",
          signal_type: "color",
          value: "green",
          polarity: 1,
          source: "stated",
          status: "active",
        },
      ],
      forbidden: [{ person: "self", signal_type: "color", value: "green" }],
    },
  }),

  cse("id-07", {
    seed: { people: [self, { relation: "friend", name: "Andrew" }] },
    turns: [{ user: "my friend Andro wants sneakers" }],
    expect: {
      people: [self, { relation: "friend", name: "Andrew" }],
      facts: [],
      signals: [],
      forbidden: [],
    },
  }),

  cse("id-08", {
    seed: { people: [self, { relation: "friend", name: "Andrew" }] },
    turns: [{ user: "my friend Andrea wants sneakers" }],
    expect: {
      people: [self, { relation: "friend", name: "Andrew" }],
      facts: [],
      signals: [],
      forbidden: [],
      next_router_asks: [{ gap: "recipient", chips_include: ["Andrew"] }],
    },
  }),

  cse("id-09", {
    seed: {
      people: [
        self,
        { relation: "son", name: "Sam" },
        { relation: "brother", name: "Sam" },
      ],
    },
    turns: [{ user: "my son Sami needs shorts" }],
    expect: {
      people: [
        self,
        { relation: "son", name: "Sam" },
        { relation: "brother", name: "Sam" },
      ],
      facts: [],
      signals: [],
      forbidden: [],
      next_router_asks: [{ gap: "recipient", chips_include: ["son (Sam)"] }],
    },
  }),

  cse("id-10", {
    seed: { people: [self, { relation: "friend", name: "Andrew" }] },
    turns: [{ user: "Andrew likes loafers" }],
    expect: {
      people: [self, { relation: "friend", name: "Andrew" }],
      facts: [],
      signals: [
        {
          person: "friend (Andrew)",
          signal_type: "style",
          value: "loafers",
          polarity: 1,
          source: "stated",
          status: "active",
        },
      ],
      forbidden: [],
    },
  }),

  cse("id-11", {
    seed: {
      people: [
        self,
        { relation: "friend", name: "Andrew" },
        { relation: "colleague", name: "Andrew" },
      ],
    },
    turns: [{ user: "Andrew likes navy" }],
    expect: {
      people: [
        self,
        { relation: "friend", name: "Andrew" },
        { relation: "colleague", name: "Andrew" },
      ],
      facts: [],
      signals: [],
      forbidden: [{ person: "self", signal_type: "color", value: "navy" }],
      next_router_asks: [
        {
          gap: "recipient",
          chips_include: ["friend (Andrew)", "colleague (Andrew)"],
        },
      ],
    },
  }),

  cse("id-12", {
    seed: { people: [self, { relation: "mother", name: "Rima" }] },
    turns: [{ user: "لماما ريما" }],
    expect: {
      people: [self, { relation: "mother", name: "Rima" }],
      facts: [],
      signals: [],
      forbidden: [],
    },
  }),

  cse("id-13", {
    seed: { people: [self, { relation: "friend", name: "Andre" }] },
    turns: [{ user: "André wants a coat" }],
    expect: {
      people: [self, { relation: "friend", name: "Andre" }],
      facts: [],
      signals: [],
      forbidden: [],
    },
  }),

  cse("claim-01", {
    seed: { people: [self] },
    turns: [
      { user: "a black shirt for the funeral" },
      {
        assistant_results: {
          garments: ["black shirt"],
          search_id: "claim-01",
          recipient: "self",
          attributes: { color: "black", garment: "shirt", occasion: "funeral" },
        },
      },
    ],
    expect: {
      people: [self],
      facts: [],
      signals: [],
      forbidden: [{ person: "self", signal_type: "color", value: "black" }],
      request_events: [{ person: "self", count: 1 }],
    },
  }),

  cse("claim-02", {
    seed: { people: [self] },
    turns: [{ user: "I always wear black" }],
    expect: {
      people: [self],
      facts: [],
      signals: [
        {
          person: "self",
          signal_type: "color",
          value: "black",
          polarity: 1,
          source: "stated",
          status: "active",
        },
      ],
      forbidden: [],
    },
  }),

  cse("claim-03", {
    seed: { people: [self] },
    turns: [
      { user: "not too flashy this time" },
      { user: "I hate big logos" },
    ],
    expect: {
      people: [self],
      facts: [],
      signals: [
        {
          person: "self",
          signal_type: "style",
          value: "logos",
          polarity: -1,
          source: "stated",
          status: "active",
        },
      ],
      forbidden: [],
    },
  }),

  cse("claim-04", {
    seed: { people: [self] },
    turns: [
      {
        assistant_ask: {
          questions: [
            {
              gap: "size",
              text: "What's your typical top size?",
              garment_type: "tops",
              field: "size_tops",
            },
          ],
        },
      },
      { user: "Medium" },
    ],
    expect: {
      people: [self],
      facts: [
        {
          person: "self",
          fact_type: "size",
          garment_type: "tops",
          value: size("M"),
          status: "active",
        },
      ],
      signals: [],
      forbidden: [],
    },
  }),

  cse("claim-05", {
    seed: { people: [self] },
    turns: [{ user: "get me linen — I'm allergic to polyester anyway" }],
    expect: {
      people: [self],
      facts: [
        {
          person: "self",
          fact_type: "no_go",
          garment_type: "nogo-material-polyester",
          value: { kind: "material", value: "polyester" },
          status: "active",
        },
      ],
      signals: [],
      forbidden: [{ person: "self", signal_type: "material", value: "linen" }],
    },
  }),

  cse("ctx-01", {
    seed: {
      people: [self],
      facts: [
        { person: "self", fact_type: "fit", value: { fit: "slim" } },
      ],
    },
    turns: [{ user: "for the gym I want loose" }],
    expect: {
      people: [self],
      facts: [
        {
          person: "self",
          fact_type: "fit",
          value: { fit: "slim" },
          status: "active",
        },
      ],
      signals: [
        {
          person: "self",
          signal_type: "silhouette",
          value: "relaxed",
          polarity: 1,
          source: "stated",
          status: "active",
          context: "gym",
        },
      ],
      forbidden: [],
    },
  }),

  cse("ctx-02", {
    seed: {
      people: [self],
      facts: [
        {
          person: "self",
          fact_type: "size",
          garment_type: "tops",
          value: size("M"),
        },
      ],
    },
    turns: [{ user: "actually I'm an L now" }],
    expect: {
      people: [self],
      facts: [
        {
          person: "self",
          fact_type: "size",
          garment_type: "tops",
          value: size("M"),
          status: "superseded",
        },
        {
          person: "self",
          fact_type: "size",
          garment_type: "tops",
          value: size("L"),
          status: "active",
        },
      ],
      signals: [],
      forbidden: [],
    },
  }),

  cse("ctx-03", {
    seed: {
      people: [self],
      signals: [
        {
          person: "self",
          signal_type: "color",
          value: "navy",
          polarity: 1,
          source: "stated",
          status: "active",
        },
      ],
    },
    turns: [
      {
        assistant_results: {
          garments: ["navy shirt"],
          search_id: "ctx-03",
          recipient: "self",
          attributes: { color: "navy" },
        },
      },
      {
        rail: {
          kind: "tier1_reject",
          search_id: "ctx-03",
          ref: "n1",
          attrs: { color: "navy" },
        },
      },
      {
        rail: {
          kind: "tier1_reject",
          search_id: "ctx-03",
          ref: "n2",
          attrs: { color: "navy" },
        },
      },
      {
        rail: {
          kind: "tier1_reject",
          search_id: "ctx-03",
          ref: "n3",
          attrs: { color: "navy" },
        },
      },
    ],
    expect: {
      people: [self],
      facts: [],
      signals: [
        {
          person: "self",
          signal_type: "color",
          value: "navy",
          polarity: 1,
          source: "stated",
          status: "active",
        },
      ],
      forbidden: [],
    },
  }),

  cse("ctx-04", {
    seed: {
      people: [self],
      facts: [
        {
          person: "self",
          fact_type: "size",
          garment_type: "tops",
          value: size("M"),
        },
      ],
    },
    turns: [{ user: "I'm an M" }],
    expect: {
      people: [self],
      facts: [
        {
          person: "self",
          fact_type: "size",
          garment_type: "tops",
          value: size("M"),
          status: "active",
        },
      ],
      signals: [],
      forbidden: [],
    },
  }),

  cse("ctx-05", {
    seed: {
      people: [self],
      signals: [
        {
          person: "self",
          signal_type: "color",
          value: "navy",
          polarity: 1,
          source: "stated",
          status: "active",
        },
      ],
    },
    turns: [{ user: "I'm done with navy" }],
    expect: {
      people: [self],
      facts: [],
      signals: [
        {
          person: "self",
          signal_type: "color",
          value: "navy",
          polarity: 1,
          source: "stated",
          status: "superseded",
        },
        {
          person: "self",
          signal_type: "color",
          value: "navy",
          polarity: -1,
          source: "stated",
          status: "active",
        },
      ],
      forbidden: [],
    },
  }),

  cse("canon-01", {
    seed: {
      people: [self],
      signals: [
        {
          person: "self",
          signal_type: "color",
          value: "navy",
          polarity: 1,
          source: "stated",
          status: "active",
        },
      ],
    },
    turns: [{ user: "dark blue is my color" }],
    expect: {
      people: [self],
      facts: [],
      signals: [
        {
          person: "self",
          signal_type: "color",
          value: "navy",
          polarity: 1,
          source: "stated",
          status: "active",
        },
      ],
      forbidden: [{ person: "self", signal_type: "color", value: "dark blue" }],
    },
  }),

  cse("canon-02", {
    seed: {
      people: [self],
      signals: [
        {
          person: "self",
          signal_type: "aesthetic",
          value: "quiet luxury",
          polarity: 1,
          source: "stated",
          status: "active",
        },
      ],
    },
    turns: [{ user: "I like understated stuff" }],
    expect: {
      people: [self],
      facts: [],
      signals: [
        {
          person: "self",
          signal_type: "aesthetic",
          value: "quiet luxury",
          polarity: 1,
          source: "stated",
          status: "active",
        },
      ],
      forbidden: [],
    },
  }),

  cse("ss-01", {
    seed: { people: [self] },
    turns: [
      {
        assistant_ask: {
          questions: [
            { gap: "depth", text: "How many looks should I pull?", chips: ["You decide", "2 looks", "3 looks"] },
          ],
        },
      },
      { chip_tap: "You decide" },
      {
        assistant_ask: {
          questions: [
            { gap: "depth", text: "Want me to decide the count again?", chips: ["You decide", "2 looks"] },
          ],
        },
      },
      { chip_tap: "You decide" },
    ],
    expect: {
      people: [self],
      facts: [],
      signals: [
        {
          person: "self",
          signal_type: "shopping_style",
          value: "quick",
          polarity: 1,
          source: "inferred",
          status: "candidate",
        },
      ],
      forbidden: [],
    },
  }),

  cse("ss-02", {
    seed: { people: [self] },
    turns: [
      { user: "always show me 5 options" },
      {
        assistant_ask: {
          questions: [
            { gap: "depth", text: "How many looks this time?", chips: ["3 looks", "5 looks", "You decide"] },
          ],
        },
      },
      { chip_tap: "3 looks" },
    ],
    expect: {
      people: [self],
      facts: [
        {
          person: "self",
          fact_type: "depth_default",
          value: { count: 5, unit: "options" },
          status: "active",
        },
      ],
      signals: [],
      forbidden: [],
    },
  }),

  cse("ss-03", {
    seed: { people: [self] },
    turns: [
      {
        assistant_ask: {
          questions: [
            { gap: "preference_anchor", text: "Keep it familiar or push?", chips: ["The usual", "Push me"] },
          ],
        },
        conversation: "v1",
      },
      { chip_tap: "The usual", conversation: "v1" },
      {
        assistant_ask: {
          questions: [
            { gap: "preference_anchor", text: "Keep it familiar or push?", chips: ["The usual", "Push me"] },
          ],
        },
        conversation: "v2",
      },
      { chip_tap: "The usual", conversation: "v2" },
      {
        assistant_ask: {
          questions: [
            { gap: "preference_anchor", text: "Keep it familiar or push?", chips: ["The usual", "Push me"] },
          ],
        },
        conversation: "v3",
      },
      { chip_tap: "The usual", conversation: "v3" },
    ],
    expect: {
      people: [self],
      facts: [],
      signals: [],
      forbidden: [
        { person: "self", signal_type: "shopping_style" },
      ],
    },
  }),

  cse("m-01", {
    seed: { people: [self] },
    turns: [
      { user: "my waist is 84cm" },
      { user: "waist is 86cm now" },
    ],
    expect: {
      people: [self],
      facts: [
        {
          person: "self",
          fact_type: "measurement",
          garment_type: "waist",
          value: { metric: "waist", value: 84, unit: "cm" },
          status: "superseded",
        },
        {
          person: "self",
          fact_type: "measurement",
          garment_type: "waist",
          value: { metric: "waist", value: 86, unit: "cm" },
          status: "active",
        },
      ],
      signals: [],
      forbidden: [],
    },
  }),

  cse("m-02", {
    seed: { people: [self, { relation: "mother" }] },
    turns: [
      { user: "I shop men's" },
      { user: "she prefers the women's section" },
    ],
    expect: {
      people: [self, { relation: "mother" }],
      facts: [
        {
          person: "self",
          fact_type: "gender_presentation",
          value: { presentation: "mens" },
          status: "active",
        },
        {
          person: "mother",
          fact_type: "gender_presentation",
          value: { presentation: "womens" },
          status: "active",
        },
      ],
      signals: [],
      forbidden: [],
    },
  }),

  cse("m-03", {
    seed: {
      people: [self],
      facts: [
        {
          person: "self",
          fact_type: "body_note",
          garment_type: "onboarding-meta",
          value: { value_philosophy: "quality first" },
        },
      ],
      signals: [
        {
          person: "self",
          signal_type: "aesthetic",
          value: "quality first",
          polarity: 1,
          source: "inferred",
          status: "candidate",
          confidence: 0.55,
        },
      ],
    },
    turns: [],
    expect: {
      people: [self],
      facts: [
        {
          person: "self",
          fact_type: "body_note",
          garment_type: "onboarding-meta",
          value: { value_philosophy: "quality first" },
          status: "active",
        },
      ],
      signals: [
        {
          person: "self",
          signal_type: "aesthetic",
          value: "quality first",
          polarity: 1,
          source: "inferred",
          status: "candidate",
        },
      ],
      forbidden: [{ person: "self", fact_type: "budget_band" }],
    },
  }),

  cse("corr-01", {
    seed: { people: [self] },
    turns: [
      {
        assistant_results: {
          garments: ["navy shirt"],
          search_id: "c1a",
          recipient: "self",
          attributes: { color: "navy" },
        },
        conversation: "c1",
      },
      {
        assistant_results: {
          garments: ["navy knit"],
          search_id: "c1b",
          recipient: "self",
          attributes: { color: "navy" },
        },
        conversation: "c1",
      },
      {
        assistant_results: {
          garments: ["navy trousers"],
          search_id: "c2a",
          recipient: "self",
          attributes: { color: "navy" },
        },
        conversation: "c2",
      },
      { user: "what else do you have in that color", conversation: "c2" },
    ],
    expect: {
      people: [self],
      facts: [],
      signals: [
        {
          person: "self",
          signal_type: "color",
          value: "navy",
          polarity: 1,
          source: "inferred",
          status: "candidate",
          confidence: 0.4,
        },
      ],
      forbidden: [],
    },
  }),

  cse("corr-02", {
    seed: { people: [self, { relation: "mother" }] },
    turns: [
      {
        assistant_results: {
          garments: ["navy dress"],
          search_id: "g1",
          recipient: "mother",
          attributes: { color: "navy" },
        },
        conversation: "g1",
      },
      {
        assistant_results: {
          garments: ["navy blouse"],
          search_id: "g2",
          recipient: "mother",
          attributes: { color: "navy" },
        },
        conversation: "g2",
      },
      {
        assistant_results: {
          garments: ["navy coat"],
          search_id: "g3",
          recipient: "mother",
          attributes: { color: "navy" },
        },
        conversation: "g3",
      },
      { user: "thanks", conversation: "g3" },
      { sweep: true, conversation: "g3" },
    ],
    expect: {
      people: [self, { relation: "mother" }],
      facts: [],
      signals: [],
      forbidden: [
        { person: "mother", signal_type: "color", value: "navy" },
        { person: "self", signal_type: "color", value: "navy" },
      ],
    },
  }),

  cse("gate-01", {
    seed: { people: [self] },
    turns: [
      {
        assistant_results: {
          garments: ["shirt"],
          search_id: "g",
          recipient: "self",
        },
      },
      { user: "ok" },
      { user: "I always wear black" },
    ],
    expect: {
      people: [self],
      facts: [],
      signals: [
        {
          person: "self",
          signal_type: "color",
          value: "black",
          polarity: 1,
          source: "stated",
          status: "active",
        },
      ],
      forbidden: [],
    },
  }),

  cse("gate-02", {
    seed: { people: [self] },
    turns: [
      {
        assistant_ask: {
          questions: [
            {
              gap: "size",
              text: "What's your typical top size?",
              garment_type: "tops",
              field: "size_tops",
            },
          ],
        },
      },
      { user: "Medium" },
    ],
    expect: {
      people: [self],
      facts: [
        {
          person: "self",
          fact_type: "size",
          garment_type: "tops",
          value: size("M"),
          status: "active",
        },
      ],
      signals: [],
      forbidden: [],
    },
  }),

  cse("gate-03", {
    seed: { people: [self] },
    turns: [
      {
        assistant_ask: {
          questions: [
            {
              gap: "size",
              text: "What's your typical top size?",
              garment_type: "tops",
              field: "size_tops",
            },
          ],
        },
      },
      { user: "Medium" },
      { sweep: true },
    ],
    expect: {
      people: [self],
      facts: [
        {
          person: "self",
          fact_type: "size",
          garment_type: "tops",
          value: size("M"),
          status: "active",
        },
      ],
      signals: [],
      forbidden: [],
    },
  }),

  cse("ev-01", {
    seed: { people: [self] },
    turns: [{ user: "I always wear \u201Cblack\u201D" }],
    expect: {
      people: [self],
      facts: [],
      signals: [
        {
          person: "self",
          signal_type: "color",
          value: "black",
          polarity: 1,
          source: "stated",
          status: "active",
        },
      ],
      forbidden: [],
    },
  }),

  cse("ev-02", {
    seed: { people: [self] },
    turns: [
      { user: "I always wear black" },
      { user: "find me a shirt" },
    ],
    expect: {
      people: [self],
      facts: [],
      signals: [
        {
          person: "self",
          signal_type: "color",
          value: "black",
          polarity: 1,
          source: "stated",
          status: "active",
        },
      ],
      forbidden: [],
    },
  }),

  cse("buy-01", {
    seed: { people: [self, { relation: "mother" }] },
    turns: [
      { user: "a navy dress for my mother" },
      {
        assistant_results: {
          garments: ["navy dress"],
          search_id: "buy-01",
          recipient: "mother",
          attributes: { color: "navy", garment: "dress", brand: "cos" },
        },
      },
      {
        purchase: {
          search_id: "buy-01",
          ref: "dress-1",
          attrs: { color: "navy", brand: "cos", garment: "dress" },
        },
      },
    ],
    expect: {
      people: [self, { relation: "mother" }],
      facts: [],
      signals: [
        {
          person: "mother",
          signal_type: "color",
          value: "navy",
          polarity: 1,
          source: "stated",
          status: "active",
          confidence: 0.9,
        },
      ],
      forbidden: [{ person: "self", signal_type: "color", value: "navy" }],
      request_events: [{ person: "mother", count: 2 }],
    },
  }),

  cse("buy-02", {
    seed: { people: [self] },
    turns: [
      {
        assistant_results: {
          garments: ["white shirt"],
          search_id: "buy-02",
          recipient: "self",
          attributes: { color: "white", garment: "shirt", brand: "unqlo" },
        },
      },
      {
        rail: {
          kind: "outbound_click",
          search_id: "buy-02",
          ref: "click-1",
          attrs: { color: "white", garment: "shirt", brand: "unqlo" },
        },
      },
      {
        purchase: {
          search_id: "buy-02",
          ref: "shirt-1",
          attrs: { color: "white", garment: "shirt", brand: "unqlo" },
        },
      },
    ],
    expect: {
      people: [self],
      facts: [],
      signals: [
        {
          person: "self",
          signal_type: "brand",
          value: "unqlo",
          polarity: 1,
          source: "stated",
          status: "active",
          confidence: 0.9,
        },
        {
          person: "self",
          signal_type: "color",
          value: "white",
          polarity: 1,
          source: "stated",
          status: "active",
          confidence: 0.9,
        },
        {
          person: "self",
          signal_type: "garment",
          value: "shirt",
          polarity: 1,
          source: "stated",
          status: "active",
          confidence: 0.9,
        },
      ],
      forbidden: [],
      recent_picks_prefers_purchase: true,
    },
  }),
];

export function memoryCaseById(id: string): MemoryCase | undefined {
  return MEMORY_CASES.find((c) => c.id === id);
}
