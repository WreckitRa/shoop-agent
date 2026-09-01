import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  attachReusedVerified,
  familyKeyForSlot,
  reusedBenchIsAssembled,
  type ReusedSlot,
} from "./reuse-slots";
import type { FashionSlotCatalogResult } from "./types";
import type { HydratedCandidate } from "../hydration/types";

function candidate(id: string): HydratedCandidate {
  return {
    id,
    upid: id,
    matched_by: [0],
    matched_by_color_variant: false,
    title: id,
    variant_options: [],
    image_urls: [],
    media_urls: [`https://img.example/${id}.jpg`],
    raw: { id, title: id },
    size_status: "confirmed",
  };
}

describe("reusedBenchIsAssembled", () => {
  it("is true only for rescore-only when every plan family is in the pool", () => {
    const reusedByFamily = new Map<string, ReusedSlot>([
      [
        familyKeyForSlot("coat"),
        {
          family: familyKeyForSlot("coat"),
          slot: { slot_id: "coat", garment: "coat", products: [], query_variants_used: [], counts: { unique_products: 0, per_variant: [], reformulated: false }, query_logs: [] },
          verified: [candidate("c1")],
        },
      ],
      [
        familyKeyForSlot("boots"),
        {
          family: familyKeyForSlot("boots"),
          slot: { slot_id: "boots", garment: "boots", products: [], query_variants_used: [], counts: { unique_products: 0, per_variant: [], reformulated: false }, query_logs: [] },
          verified: [candidate("b1")],
        },
      ],
    ]);
    assert.equal(
      reusedBenchIsAssembled({
        mode: "rescore-only",
        reusedByFamily,
        planSlots: [{ garment: "coat" }, { garment: "boots" }],
      }),
      true,
    );
    assert.equal(
      reusedBenchIsAssembled({
        mode: "full",
        reusedByFamily,
        planSlots: [{ garment: "coat" }, { garment: "boots" }],
      }),
      false,
    );
    assert.equal(
      reusedBenchIsAssembled({
        mode: "rescore-only",
        reusedByFamily,
        planSlots: [{ garment: "coat" }, { garment: "shirt" }],
      }),
      false,
    );
  });
});

describe("attachReusedVerified", () => {
  it("keeps only hydrated rows that survived rescore", () => {
    const slots: FashionSlotCatalogResult[] = [
      {
        slot_id: "coat",
        garment: "coat",
        products: [candidate("c1")],
        query_variants_used: [],
        counts: { unique_products: 1, per_variant: [], reformulated: false },
        query_logs: [],
      },
    ];
    const reuse = new Map([["coat", [candidate("c1"), candidate("c2")]]]);
    const next = attachReusedVerified({ slots, reuseVerifiedBySlot: reuse });
    assert.equal(next[0]!.verified_pool?.map((c) => c.id).join(","), "c1");
  });
});
