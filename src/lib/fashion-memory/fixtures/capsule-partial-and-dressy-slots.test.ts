import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parsePreferenceAnchorFromWords,
  profileHasRelevantAnchorSignal,
} from "../router/anchor-gate";
import { ensureClarificationQuickOptions } from "../router/clarification-defaults";
import {
  enrichSlotsChecklistQuestion,
  defaultOutfitSlotsOptions,
} from "../router/slots-checklist";
import { parseSlotsClarificationAnswer } from "../intake/apply-intake-reply";
import type { StyleSignalRow } from "../types";

function signal(
  partial: Pick<StyleSignalRow, "signal_type" | "value" | "context">,
): StyleSignalRow {
  return {
    id: partial.value,
    user_id: "u",
    person_id: "p",
    signal_type: partial.signal_type,
    context: partial.context,
    value: partial.value,
    polarity: 1,
    source: "stated",
    status: "active",
    confidence: 1,
    evidence_count: 1,
    source_quote: null,
    first_seen_at: "",
    last_seen_at: "",
  };
}

describe("capsule×partial class (b) — preference_anchor", () => {
  it("push me wins over keep it smart casual in the same message", () => {
    assert.equal(
      parsePreferenceAnchorFromWords(
        "Shoes, dress. Push me a little, and 2 looks please. I want to mix it up but keep it smart casual for the office.",
      ),
      "push",
    );
  });

  it("keep it focused is not preference_anchor keep", () => {
    assert.equal(
      parsePreferenceAnchorFromWords(
        "shirts, trousers, sneakers. Keep it focused though.",
      ),
      null,
    );
  });

  it("preference_anchor chips stay The usual / Push / Something new", () => {
    const q = ensureClarificationQuickOptions({
      text: "Navy or tailored?",
      gap: "preference_anchor",
      kind: "consult",
      quick_options: ["Navy", "Tailored", "Surprise me"],
    });
    const labels = (q.quick_options ?? []).map((o) =>
      typeof o === "string" ? o : o.label,
    );
    assert.deepEqual(labels, [
      "The usual",
      "Push me a little",
      "Something new",
    ]);
  });

  it("aesthetic navy/tailored signals count as relevant for any brief garments", () => {
    assert.equal(
      profileHasRelevantAnchorSignal({
        garments: ["sneakers", "coat"],
        signals: [
          signal({ signal_type: "color", value: "navy", context: "work" }),
          signal({ signal_type: "style", value: "tailored", context: "work" }),
        ],
      }),
      true,
    );
  });
});

describe("capsule×partial class (c) — ticks across size/escape", () => {
  it("keeps Top/Bottoms/Shoes when impatience trails the slots answer", () => {
    const got = parseSlotsClarificationAnswer(
      "Top, Bottoms, Shoes. just show me what you've got",
      ["Dress", "Top", "Bottoms", "Shoes", "Bag", "Add a piece"],
    );
    assert.deepEqual(got.sort(), ["Bottoms", "Shoes", "Top"].sort());
  });
});

describe("dressy slots jacket layer", () => {
  it("baptism/dressy outfit defaults include preselected Blazer", () => {
    const opts = defaultOutfitSlotsOptions({
      occasion: "baptism with family tomorrow",
      formality: "dressy",
    });
    const blazer = opts.find((o) => /blazer/i.test(o.label));
    assert.ok(blazer?.preselected);
  });

  it("enrich adds preselected Blazer when LLM omitted jacket on dressy brief", () => {
    const q = enrichSlotsChecklistQuestion(
      {
        text: "What should I pull?",
        gap: "slots",
        quick_options: ["Top", "Bottoms", "Shoes"],
      },
      {
        request_type: "outfit",
        occasion_context: "baptism with family",
        depth: { looks_wanted: 1, source: "stated" },
        style_direction: "dressy",
      },
    );
    const opts = (q.quick_options ?? []).map((o) =>
      typeof o === "string" ? { label: o, preselected: false } : o,
    );
    const jacket = opts.find((o) => /\b(blazer|jacket)\b/i.test(o.label));
    assert.ok(jacket);
    assert.equal(jacket?.preselected, true);
  });
});
