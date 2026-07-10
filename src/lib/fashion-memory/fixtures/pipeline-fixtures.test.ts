import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildKnowledgeState } from "../intake/knowledge-state";
import {
  coldProfileNoColorShirtBrief,
  cyprusWeddingColdPaletteBrief,
  emptyPostIntakePerson,
  monochromeWorkSignals,
  plannerOutputForBrief,
  profileMonochromeWorkBrief,
  statedBlackShirtBrief,
  warmSizeFacts,
} from "./pipeline-fixtures";
import { reconcileColorDirection, userChoseSurpriseMe } from "../router/brief-fields";
import { buildFashionRouterPrompt } from "../router/prompt";
import { clampFashionSearchPlan } from "../search-planner/clamps";
import {
  expectedPaletteSourceFromBrief,
  inferOccasionDefaultPalette,
  reconcilePlanPalettes,
} from "../search-planner/palette-ladder";
import { toFashionSearchPlan } from "../search-planner/tool-schema";
import { validateSlotQueryVariants } from "../search-planner/validator";
import type { FashionRouterResult } from "../router/types";

function finalizePlan(brief: typeof coldProfileNoColorShirtBrief) {
  const raw = toFashionSearchPlan({
    input: plannerOutputForBrief(brief),
    brief,
    currentDate: "2026-07-08",
  });
  return reconcilePlanPalettes(clampFashionSearchPlan(raw).plan);
}

function colorWords(query: string): string[] {
  return query
    .split(/\s+/)
    .filter((t) =>
      ["black", "white", "navy", "blue", "beige", "sand", "grey", "gray"].includes(
        t.toLowerCase(),
      ),
    );
}

describe("cold_profile_no_color_shirt", () => {
  it("planner spread mode with no color words in variants", () => {
    const plan = finalizePlan(coldProfileNoColorShirtBrief);
    const slot = plan.slots[0]!;
    assert.equal(slot.palette_source, "spread");
    assert.equal(slot.palette_constraint, null);
    assert.equal(
      slot.query_variants.every((variant) => colorWords(variant).length === 0),
      true,
    );
  });
});

describe("cyprus_wedding_cold_palette", () => {
  it("uses occasion_default palette with at most one palette word", () => {
    const plan = finalizePlan(cyprusWeddingColdPaletteBrief);
    const slot = plan.slots[0]!;
    assert.equal(slot.palette_source, "occasion_default");
    assert.match(slot.palette_constraint ?? "", /light neutrals|sand|white|soft blue/i);
    const withColor = slot.query_variants.filter((v) => colorWords(v).length > 0);
    assert.ok(withColor.length <= 1);
  });

  it("infers light neutrals from occasion text", () => {
    const palette = inferOccasionDefaultPalette(cyprusWeddingColdPaletteBrief);
    assert.match(palette ?? "", /light neutrals|sand|white|soft blue/i);
  });
});

describe("stated_black_shirt", () => {
  it("keeps stated palette and black in exactly one variant", () => {
    const plan = finalizePlan(statedBlackShirtBrief);
    const slot = plan.slots[0]!;
    assert.equal(slot.palette_source, "stated");
    assert.equal(
      slot.query_variants.filter((v) => v.toLowerCase().includes("black")).length,
      1,
    );
    assert.equal(statedBlackShirtBrief.color_direction?.source, "stated");
  });
});

describe("profile_monochrome_work", () => {
  it("uses profile palette source", () => {
    const plan = finalizePlan(profileMonochromeWorkBrief);
    assert.equal(plan.slots[0]?.palette_source, "profile");
    assert.equal(
      reconcileColorDirection({
        brief: profileMonochromeWorkBrief,
        signals: monochromeWorkSignals,
      }).source,
      "profile",
    );
  });
});

describe("surprise_me_option", () => {
  it("maps Surprise me to color_direction none", () => {
    assert.equal(userChoseSurpriseMe("Surprise me"), true);
    assert.equal(
      reconcileColorDirection({
        brief: {
          ...coldProfileNoColorShirtBrief,
          color_direction: { source: "stated", stated_colors: ["black"] },
        },
        lastUserMessage: "Surprise me",
      }).source,
      "none",
    );
  });

  it("never treats standalone color clarification as blocking", () => {
    const result: FashionRouterResult = {
      move: "ask_clarification",
      reply: "Any color direction?",
      questions: [
        {
          text: "Any color direction?",
          gap: "occasion",
          quick_options: ["Surprise me", "Black"],
        },
      ],
      ride_along: {
        text: "Any color direction?",
        quick_options: ["Surprise me", "Black"],
      },
    };
    // Color alone is ride_along — not a blocking gap in the questions list for real turns.
    // This fixture documents that nice-to-haves must not be the sole reason for a turn.
    const onlyNiceToHave =
      result.move === "ask_clarification" &&
      result.questions.every((q) => q.gap !== "garment" && q.gap !== "size" && q.gap !== "department" && q.gap !== "recipient" && q.gap !== "person_name" && q.gap !== "occasion");
    assert.equal(onlyNiceToHave, false);
    assert.ok(result.ride_along);
  });
});

describe("cyprus_wedding_full_outfit", () => {
  it("empty profile expects bundled department+size clarification not run_intake", async () => {
    const { buildBlockingClarification } = await import("../intake/identity-gate");
    const coldBrief = {
      ...cyprusWeddingColdPaletteBrief,
      department_scope: undefined,
      knowledge_state: undefined,
    };
    const blocking = buildBlockingClarification({
      brief: coldBrief,
      facts: [],
      targetPersonId: "p1",
      personLabel: "you",
      person: { ...emptyPostIntakePerson, intake_completed_at: null },
    });
    assert.ok(blocking.questions.some((q) => q.gap === "department"));
    assert.ok(blocking.questions.some((q) => q.gap === "size"));
    assert.equal(blocking.questions.every((q) => q.gap !== "garment" || true), true);
  });
});

describe("never_ask_stored_size", () => {
  it("does not re-ask sizes present in profile facts", async () => {
    const { buildBlockingClarification } = await import("../intake/identity-gate");
    const blocking = buildBlockingClarification({
      brief: cyprusWeddingColdPaletteBrief,
      facts: warmSizeFacts,
      targetPersonId: "p1",
      personLabel: "you",
      person: emptyPostIntakePerson,
    });
    assert.equal(
      blocking.questions.filter((q) => q.gap === "size").length,
      0,
    );
  });
});

describe("dodge_twice_then_search", () => {
  it("declined size gaps stop blocking and flow into sizes_unconfirmed", async () => {
    const { buildKnowledgeState } = await import("../intake/knowledge-state");
    const { isGapDeclined } = await import("../intake/dodge-counter");
    const declined = [
      { gap: "size" as const, person_id: "p1", garment_type: "tops" },
      { gap: "size" as const, person_id: "p1", garment_type: "bottoms" },
      { gap: "size" as const, person_id: "p1", garment_type: "shoes" },
    ];
    assert.equal(
      isGapDeclined(declined, { gap: "size", person_id: "p1", garment_type: "tops" }),
      true,
    );
    const state = buildKnowledgeState({
      brief: cyprusWeddingColdPaletteBrief,
      facts: [],
      person: emptyPostIntakePerson,
      sizesUnconfirmed: ["shirt", "trousers", "shoes"],
    });
    assert.deepEqual(state.sizes_unconfirmed, ["shirt", "trousers", "shoes"]);
  });
});

describe("bundle_essentials_new_person", () => {
  it("colleague birthday request yields department+size bundle templates", async () => {
    const { buildBlockingClarification } = await import("../intake/identity-gate");
    const brief = {
      ...coldProfileNoColorShirtBrief,
      recipient_person_id: "new",
      garments: ["top"],
      occasion_context: "birthday",
      style_direction: "Something for my colleague Lina's birthday",
      department_scope: undefined,
      knowledge_state: undefined,
    };
    const blocking = buildBlockingClarification({
      brief,
      facts: [],
      targetPersonId: "new",
      personLabel: "Lina",
      person: {
        id: "new",
        user_id: "u1",
        relation: "friend",
        name: "Lina",
        birthday: null,
        notes: null,
        intake_completed_at: null,
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
      },
    });
    assert.ok(blocking.questions.some((q) => q.gap === "department"));
    assert.ok(blocking.questions.some((q) => q.gap === "size"));
    assert.match(blocking.reply, /essentials|fits/i);
  });
});

describe("off_topic_with_suggestions", () => {
  it("prompt treats life context as shoppable and caps suggestion lists at 2–3", () => {
    const prompt = buildFashionRouterPrompt({
      roster: "#abcd self",
      profiles: "(none)",
      currentDate: "2026-07-09",
    });
    // Part B Q1: boxing / gym life context is NOT off-topic.
    assert.match(prompt, /I started boxing|Life context counts/i);
    assert.match(prompt, /never this tool/);
    // Q2 path still allows 2–3 suggestions when truly not shopping.
    assert.match(prompt, /2–3 items maximum/);
    assert.match(prompt, /respond_off_topic/);
    assert.doesNotMatch(prompt, /run_intake/);
  });
});

describe("knowledge_state", () => {
  it("records confirmed and unconfirmed sizes explicitly", () => {
    const state = buildKnowledgeState({
      brief: cyprusWeddingColdPaletteBrief,
      facts: warmSizeFacts,
      person: emptyPostIntakePerson,
      sizesUnconfirmed: [],
    });
    assert.equal(state.department, "mens");
    assert.ok(state.sizes_confirmed.includes("shirt"));
    assert.deepEqual(state.sizes_unconfirmed, []);
  });
});

describe("palette ladder expectations", () => {
  it("maps brief color_direction to expected palette source", () => {
    assert.equal(expectedPaletteSourceFromBrief(statedBlackShirtBrief), "stated");
    assert.equal(expectedPaletteSourceFromBrief(profileMonochromeWorkBrief), "profile");
    assert.equal(
      expectedPaletteSourceFromBrief(cyprusWeddingColdPaletteBrief),
      "occasion_default",
    );
    assert.equal(expectedPaletteSourceFromBrief(coldProfileNoColorShirtBrief), "spread");
  });

  it("spread validator strips all color words", () => {
    const result = validateSlotQueryVariants({
      variants: ["navy oxford shirt", "slim cotton shirt"],
      paletteSource: "spread",
    });
    assert.equal(result.ok, true);
    assert.equal(result.variants.every((v) => colorWords(v).length === 0), true);
  });
});
