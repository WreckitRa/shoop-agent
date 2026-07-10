/**
 * Post-judge rack composition — every rack needs anchor trust; cap unknown long-tail.
 */
import { logAiChat } from "../observability";
import type { CuratedPick, CurationSlot } from "../types";
import {
  classifyBrandTier,
  isAnchorBrandProduct,
  type BrandTier,
} from "./brand-anchors";
import type { ConstraintGateDrop } from "./constraint-gate";
import type { SearchBrief } from "./types";
import type { VerifiedCandidate } from "./verify";

function brandTierFor(vc: VerifiedCandidate, brief: SearchBrief): BrandTier {
  return classifyBrandTier(vc.detail, brief.query, brief.category);
}

function isHiddenGemPick(
  pick: CuratedPick,
  vc: VerifiedCandidate | undefined,
  brief: SearchBrief,
): boolean {
  if (pick.slot !== "gem") return false;
  if (brandTierFor(vc ?? ({ detail: { id: pick.id, title: pick.title } } as VerifiedCandidate), brief) !== "unknown") {
    return false;
  }
  const reason = `${pick.reason ?? ""} ${pick.title ?? ""}`.toLowerCase();
  return /\b(material|fabric|wool|leather|sole|silhouette|cut|feature|structured|merino|cashmere)\b/.test(
    reason,
  );
}

function pickById(
  pool: VerifiedCandidate[],
  productId: string,
): VerifiedCandidate | undefined {
  return pool.find(
    (v) =>
      v.detail.id === productId ||
      v.detail.id.endsWith(productId) ||
      productId.endsWith(v.detail.id),
  );
}

/** Ensure ≥1 anchor on rack; at most one unknown unless hidden-gem with feature reason. */
export function enforceRackBrandComposition(params: {
  picks: CuratedPick[];
  pool: VerifiedCandidate[];
  brief: SearchBrief;
  buildPick: (
    vc: VerifiedCandidate,
    slot: CurationSlot,
    reason?: string,
  ) => CuratedPick;
}): { picks: CuratedPick[]; ruledOut: ConstraintGateDrop[] } {
  const { brief, pool, buildPick } = params;
  let picks = [...params.picks];
  const ruledOut: ConstraintGateDrop[] = [];
  const usedIds = new Set(picks.map((p) => p.id));

  const tierOf = (productId: string) =>
    brandTierFor(pickById(pool, productId) ?? ({ detail: { id: productId, title: "" } } as VerifiedCandidate), brief);

  const anchorCount = () =>
    picks.filter((p) => tierOf(p.id) === "anchor").length;
  const unknownPicks = () =>
    picks.filter((p) => tierOf(p.id) === "unknown");

  if (anchorCount() === 0) {
    const anchorCandidate = pool.find(
      (v) =>
        !usedIds.has(v.detail.id) &&
        isAnchorBrandProduct(v.detail, brief.query, brief.category),
    );
    if (anchorCandidate) {
      const galleryIdx = picks.findIndex((p) => p.slot === "gallery");
      const idx = galleryIdx >= 0 ? galleryIdx : picks.length - 1;
      const displaced = picks[idx];
      if (displaced) {
        ruledOut.push({
          productId: displaced.id,
          title: displaced.title ?? "",
          reason: "Replaced to add a recognizable anchor brand to the rack",
          gate: "listing_hygiene",
        });
        picks[idx] = buildPick(
          anchorCandidate,
          displaced.slot,
          "Recognizable anchor — buys trust for the rest of the rack",
        );
        usedIds.delete(displaced.id);
        usedIds.add(anchorCandidate.detail.id);
        logAiChat("info", "rack_composition_anchor_swap", {
          query: brief.query.slice(0, 120),
          anchorId: anchorCandidate.detail.id,
          displacedId: displaced.id,
        });
      }
    }
  }

  const unknowns = unknownPicks();
  if (unknowns.length <= 1) {
    return { picks, ruledOut };
  }

  const hiddenGem = unknowns.find((p) => isHiddenGemPick(p, pickById(pool, p.id), brief));
  const keepId = hiddenGem?.id ?? unknowns[0]!.id;

  for (const pick of unknowns) {
    if (pick.id === keepId) continue;
    const idx = picks.findIndex((p) => p.id === pick.id);
    if (idx < 0) continue;

    const replacement =
      pool.find(
        (v) =>
          !usedIds.has(v.detail.id) &&
          classifyBrandTier(v.detail, brief.query, brief.category) !== "unknown",
      ) ??
      pool.find(
        (v) =>
          !usedIds.has(v.detail.id) &&
          isAnchorBrandProduct(v.detail, brief.query, brief.category),
      );

    ruledOut.push({
      productId: pick.id,
      title: pick.title ?? "",
      reason: "Unknown-brand long-tail capped — rack needs recognizable anchors",
      gate: "listing_hygiene",
    });

    if (replacement) {
      picks[idx] = buildPick(
        replacement,
        pick.slot,
        pick.reason,
      );
      usedIds.delete(pick.id);
      usedIds.add(replacement.detail.id);
    } else {
      picks.splice(idx, 1);
      usedIds.delete(pick.id);
    }
  }

  if (ruledOut.length) {
    logAiChat("info", "rack_composition_unknown_cap", {
      query: brief.query.slice(0, 120),
      unknownBefore: unknowns.length,
      drops: ruledOut.length,
    });
  }

  return { picks, ruledOut };
}
