import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseSlotsClarificationAnswer } from "./apply-intake-reply";
import {
  defaultCapsuleSlotsOptions,
  enrichSlotsChecklistQuestion,
} from "../router/slots-checklist";
import {
  buildSlotsChecklistReply,
  detectSlotsChecklistInconsistency,
} from "../eval/shopper";
import type { Persona } from "../eval/persona";

describe("parseSlotsClarificationAnswer", () => {
  it("merges chip ticks with free-text garments absent from the list", () => {
    const got = parseSlotsClarificationAnswer(
      "shirt, trousers, blazer, shoes",
      ["Top", "Bottoms", "Shoes", "Light layer", "Add a piece"],
    );
    assert.ok(got.some((g) => /shoe/i.test(g)));
    assert.ok(got.some((g) => /shirt/i.test(g)));
    assert.ok(got.some((g) => /trouser/i.test(g)));
    assert.ok(got.some((g) => /blazer/i.test(g)));
  });

  it("keeps trailing free-text garment before a surprise/escape sentence", () => {
    const got = parseSlotsClarificationAnswer(
      "dress, sandals, light jacket. Surprenez-moi, et vous décidez",
      ["Robes", "Hauts", "Sandales", "Add a piece"],
    );
    assert.ok(got.some((g) => /dress|robe/i.test(g)));
    assert.ok(got.some((g) => /sandal/i.test(g)));
    assert.ok(got.some((g) => /jacket|light jacket/i.test(g)));
    assert.ok(!got.some((g) => /décidez|decide/i.test(g)));
  });

  it("keeps ticks when escape is a trailing impatience tag", () => {
    const got = parseSlotsClarificationAnswer(
      "Top, Shoes. just show me what you've got",
      ["Top", "Bottoms", "Shoes", "Add a piece"],
    );
    assert.deepEqual(got.sort(), ["Shoes", "Top"].sort());
  });
});

describe("enrichSlotsChecklistQuestion capsule", () => {
  it("ensures capsule lists are not thinner than the rotation", () => {
    const q = enrichSlotsChecklistQuestion(
      {
        text: "What should I pull?",
        gap: "slots",
        kind: "consult",
        quick_options: ["Tops", "Shoes"],
      },
      {
        request_type: "capsule",
        occasion_context: "beach week",
        depth: { looks_wanted: 4, source: "stated" },
        style_direction: "",
      },
    );
    const labels = (q.quick_options ?? []).map((o) =>
      typeof o === "string" ? o : o.label,
    );
    assert.ok(labels.length >= 5);
    assert.ok(labels.some((l) => /add a piece/i.test(l)));
  });

  it("default capsule beach set includes swim", () => {
    const opts = defaultCapsuleSlotsOptions({
      occasion: "beach vacation",
      looksWanted: 3,
    });
    assert.ok(opts.some((o) => /swim/i.test(o.label)));
  });
});

describe("shopper slots checklist", () => {
  const persona = {
    truth: {
      garments: ["jeans", "tee", "sneakers"],
      owns: ["sneakers"],
    },
  } as Persona;

  it("ticks truth − owns and free-texts missing pieces", () => {
    const reply = buildSlotsChecklistReply(persona, {
      text: "What should I pull?",
      gap: "slots",
      quick_options: ["Tops", "Bottoms", "Dress", "Add a piece"],
    });
    assert.match(reply, /Tops/i);
    assert.match(reply, /Bottoms|jeans/i);
    assert.match(reply, /tee|Tops/i);
    // sneakers owned → not ticked; jeans may map to Bottoms
    assert.ok(!/sneakers/i.test(reply));
  });

  it("does not exclude when a truth garment is missing from the checklist", () => {
    const leak = detectSlotsChecklistInconsistency({
      persona: {
        truth: {
          garments: ["dress", "sandals", "light jacket"],
          owns: [],
        },
      } as Persona,
      reply: "dress, sandals",
      slotsQuestion: {
        text: "What?",
        gap: "slots",
        quick_options: ["Dress", "Sandals", "Add a piece"],
      },
    });
    assert.equal(leak, null);
  });

  it("flags owns ticked as harness leak when all wanted were on the list", () => {
    const leak = detectSlotsChecklistInconsistency({
      persona,
      reply: "Tops, Bottoms, sneakers",
      slotsQuestion: {
        text: "What?",
        gap: "slots",
        quick_options: ["Tops", "Bottoms", "sneakers", "Add a piece"],
      },
    });
    assert.equal(leak?.fact, "slots_checklist_owns_ticked");
  });
});
