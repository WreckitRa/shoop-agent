import { normalizePickInsight } from "@/lib/commerce/pick-insight";
import type { CuratedPick, CurationSlot } from "@/lib/ai-chat/types";
import type {
  FashionCuratedPick,
  FashionCuratedPickBadge,
  FashionVerifiedTierItem,
} from "@/lib/fashion-memory/curation/types";
import type { RenderPick, RenderPickBadge } from "@/lib/fashion-memory/types/render-contract";

function roleToSlot(role: string): CurationSlot {
  if (role === "value" || role === "smart_value") return "best_value";
  if (role === "premium" || role === "stretch") return "shoop_pick";
  if (role === "hero") return "shoop_pick";
  return "shoop_pick";
}

function fashionBadgeLabel(
  badge: FashionCuratedPickBadge | RenderPickBadge,
): string | null {
  switch (badge.kind) {
    case "converted_size":
      return `Size ${badge.label} (converted from ${badge.from})`;
    case "size_converted":
      return `Size ${badge.merchant_label} (converted from ${badge.from})`;
    case "check_sizing":
    case "size_unknown":
      return "Size availability should be double-checked";
    case "material_suspected":
      return `May contain ${badge.material}`;
    case "photo_color":
      return `Photo shows ${badge.color}${badge.listed ? ` (listed as ${badge.listed})` : ""}`;
    case "near_budget_lifted":
      return "Slightly over the stated budget — closest real option";
    case "brand_unconfirmed":
      return "Brand not fully confirmed in catalog metadata";
    default:
      return null;
  }
}

/** Map a fashion curated pick into the shared chat CuratedPick shape for PDP. */
export function fashionPickToCuratedPick(
  pick: FashionCuratedPick | RenderPick,
): CuratedPick {
  const reason =
    ("stylist_line" in pick && pick.stylist_line?.trim()) ||
    `Strong match for ${"garment" in pick ? pick.garment : "your search"}.`;
  const badgeLines = (pick.badges ?? [])
    .map(fashionBadgeLabel)
    .filter((l): l is string => Boolean(l));

  const fitSeeds = [reason, ...badgeLines];
  while (fitSeeds.length < 3) {
    fitSeeds.push(
      `Verified ${"garment" in pick ? pick.garment : "item"} from your fashion search`,
    );
  }

  const checkedSeeds = [
    ...badgeLines,
    "In stock and size-checked where possible",
    "Compared against other options in this slot",
    "Fits the brief, occasion, and style direction",
  ];

  return {
    id: pick.id,
    title: pick.title,
    imageUrl: pick.imageUrl,
    displayPrice: pick.displayPrice,
    preferredOptions: pick.preferredOptions,
    featuredVariant: pick.featuredVariant,
    slot: roleToSlot("role" in pick ? String(pick.role) : "safe"),
    reason,
    verdict: "buy",
    insight: normalizePickInsight(
      {
        retailer_check_note: "Fashion curation · verified option",
        fit_reasons: fitSeeds.slice(0, 3) as [string, string, string],
        checked_items: checkedSeeds.slice(0, 5),
        pick_story:
          reason.length >= 40
            ? reason
            : `Your stylist picked this ${"garment" in pick ? pick.garment : "piece"} because ${reason}`,
        change_mind: [
          "If the size or fit doesn't work once you get it on",
          "If you want a different color or brand from the bench below",
        ],
      },
      reason,
    ),
  };
}

export function fashionVerifiedToCuratedPick(
  item: FashionVerifiedTierItem,
): CuratedPick {
  const reason = `Verified ${item.garment} alternative from your search.`;
  return {
    id: item.id,
    title: item.title,
    imageUrl: item.imageUrl,
    displayPrice: item.displayPrice,
    preferredOptions: item.preferredOptions,
    featuredVariant: item.featuredVariant,
    slot: "gallery",
    reason,
    verdict: "buy",
    insight: normalizePickInsight(null, reason),
  };
}
