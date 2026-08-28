import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CURATION_PROMPT_SKELETON } from "../curation/prompt";
import {
  isDegradedOutfitPlan,
  missingBriefGarments,
  validateCurationOutput,
} from "../curation/validate";
import { validateAndRepairFallback } from "../curation/fallback";
import { buildRefRegistry } from "../curation/refs";
import { garmentsNamedInStyleDirection } from "../search-planner/fallback-plan";
import type { FashionSearchPlan } from "../search-planner/types";
import type { HydratedCandidate } from "../hydration/types";

function candidate(
  id: string,
  slot: string,
  price: number,
): HydratedCandidate {
  return {
    id,
    upid: id,
    matched_by: [0],
    matched_by_color_variant: false,
    title: `${slot} product ${id}`,
    variant_options: [],
    price: { amount: price * 100, currency: "USD" },
    image_urls: [`https://example.com/${id}.jpg`],
    media_urls: [`https://example.com/${id}.jpg`],
    final_price: { amount: price * 100, currency: "USD" },
    size_status: "confirmed",
    score: { final: 0.9, components: {} },
  } as HydratedCandidate;
}

describe("degraded_blazer_thin_note", () => {
  it("rule 10 triggers when plan misses a brief garment, not only on count", () => {
    assert.match(CURATION_PROMPT_SKELETON, /misses any\s+brief\.garments entry/);
  });

  it("style_direction blazer is extracted for plan coverage", () => {
    assert.ok(
      garmentsNamedInStyleDirection(
        "Dressy baptism look with a blazer over the shirt.",
      ).some((g) => /blazer/i.test(g)),
    );
  });

  it("brief has blazer, plan lacks blazer → thin_note names it", () => {
    const plan: FashionSearchPlan = {
      version: 1,
      mode: "outfit",
      plan_source: "planner",
      reasoning: "test",
      currentDate: "2026-08-25",
      brief: {
        recipient_person_id: "self",
        request_type: "outfit",
        garments: ["shirt", "trousers", "blazer", "shoes"],
        occasion_context: "baptism",
        quantity_hint: "one look",
        must_haves: [],
        nice_to_haves: [],
        budget_context: { stated: false },
        style_direction: "Dressy with a blazer",
        depth: { looks_wanted: 1, source: "stated" },
      },
      slots: [
        {
          slot_id: "shirt",
          garment: "shirt",
          role: "anchor",
          style_direction: "dressy",
          palette_constraint: null,
          palette_source: "spread",
          options_wanted: 1,
          query_variants: ["mens dress shirt"],
        },
        {
          slot_id: "trousers",
          garment: "trousers",
          role: "support",
          style_direction: "dressy",
          palette_constraint: null,
          palette_source: "spread",
          options_wanted: 1,
          query_variants: ["mens dress trousers"],
        },
        {
          slot_id: "shoes",
          garment: "shoes",
          role: "support",
          style_direction: "dressy",
          palette_constraint: null,
          palette_source: "spread",
          options_wanted: 1,
          query_variants: ["mens dress shoes"],
        },
      ],
    };

    assert.equal(isDegradedOutfitPlan(plan), true);
    assert.ok(missingBriefGarments(plan).some((g) => /blazer/i.test(g)));

    const registry = buildRefRegistry({
      mode: "outfit",
      slots: plan.slots.map((s) => ({
        slot_id: s.slot_id,
        planSlot: s,
        verified: [candidate(`${s.slot_id}_1`, s.slot_id, 80)],
      })),
    });

    const bad = validateCurationOutput({
      output: {
        slots: plan.slots.map((s) => {
          const ref = [...registry.keys()].find((r) =>
            r.includes(s.slot_id),
          )!;
          return {
            slot_id: s.slot_id,
            picks: [
              {
                ref,
                role: "safe" as const,
                stylist_line: "Solid option for the ask.",
              },
            ],
          };
        }),
        vetoes: [],
        narration: { opening: "Here is your baptism look." },
      },
      registry,
      plan,
      slots: plan.slots.map((s) => ({
        slot_id: s.slot_id,
        garment: s.garment,
      })),
    });
    assert.equal(bad.ok, false);
    assert.ok(bad.issues.some((i) => i.code === "missing_thin_note"));

    const repaired = validateAndRepairFallback({
      output: bad.output,
      registry,
      plan,
      slots: plan.slots.map((s) => ({
        slot_id: s.slot_id,
        garment: s.garment,
      })),
    });
    assert.match(repaired.output.narration.thin_note ?? "", /blazer/i);
  });
});
