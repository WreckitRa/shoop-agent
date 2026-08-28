import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attachTryonToRenderContract } from "./attach-render";
import { RENDER_CONTRACT_VERSION } from "@/lib/fashion-memory/types/render-contract";
import type { RenderContract } from "@/lib/fashion-memory/types/render-contract";
import type { FashionSearchPlan } from "@/lib/fashion-memory/search-planner/types";
import { TRYON_DISCLAIMER } from "./types";

const GUEST = "guest-11111111-1111-4111-8111-111111111111";

function stubPlan(mode: FashionSearchPlan["mode"] = "single_item"): FashionSearchPlan {
  return {
    version: 1,
    mode,
    slots: [],
    reasoning: "",
    currentDate: "2026-01-01",
    brief: {
      recipient_person_id: null,
    },
  } as FashionSearchPlan;
}

function stubRender(): RenderContract {
  return {
    contract_version: RENDER_CONTRACT_VERSION,
    narration: {
      opening: "Hi",
      degradation: { kind: "none", user_line: "" },
    },
    tiers: {
      picks: [
        {
          ref: "tee_1",
          slot_id: "tee",
          garment: "t-shirt",
          id: "p1",
          title: "Tee",
          role: "hero",
          stylist_line: "",
          badges: [],
          score_rank: 1,
        },
      ],
      verified: [],
      unverified: [],
    },
    meta: { mode: "single_item", thin_slots: [], fallback: false },
    affordances: { can_recurate: false, exhausted: false },
  };
}

describe("attachTryonToRenderContract", () => {
  it("stamps create_avatar for guests instead of throwing", async () => {
    const out = await attachTryonToRenderContract({
      render: stubRender(),
      presentation: {} as never,
      plan: stubPlan(),
      userId: GUEST,
    });
    const tryon = out.tiers.picks[0]?.tryon;
    assert.equal(tryon?.available, false);
    assert.equal(tryon?.cta, "create_avatar");
    assert.equal(tryon?.disclaimer, TRYON_DISCLAIMER);
  });
});
