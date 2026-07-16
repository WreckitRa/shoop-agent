/**
 * Owned user-facing badge copy. Raw suspicion.evidence / flag strings never
 * reach the render contract.
 */
import { garmentSizingMode } from "../catalog-search/garment-taxonomy";
import type { FashionCuratedPickBadge } from "./types";
import type { HydratedCandidate } from "../hydration/types";

const MATERIAL_RULE_RE = /material|composition|fiber|fabric/i;
const MATERIAL_TOKEN_RE =
  /\b(wool|cotton|linen|silk|polyester|nylon|leather|suede|cashmere|viscose|rayon|acrylic|elastane|spandex|down|fur)\b/i;

/** Internal flags that must never become user badges. */
export const BADGE_SUPPRESSED_RULES = new Set([
  "attire_conflict_title",
  "attire_conflict",
  "department_unknown",
  "department_mismatch",
]);

export function extractMaterialToken(evidence: string): string | null {
  const m = evidence.match(MATERIAL_TOKEN_RE);
  return m?.[1]?.toLowerCase() ?? null;
}

/**
 * Build the closed badge list for a pick. Only whitelist kinds — never
 * pass through raw flag/evidence strings.
 */
export function buildUserFacingBadges(params: {
  candidate: HydratedCandidate;
  garment?: string;
  correctedColor?: string;
  nearBudgetLifted?: boolean;
}): FashionCuratedPickBadge[] {
  const badges: FashionCuratedPickBadge[] = [];
  const c = params.candidate;
  const sizing = params.garment ? garmentSizingMode(params.garment) : "standard";

  if (c.size_status === "converted" && c.size_selection) {
    badges.push({
      kind: "converted_size",
      from: c.size_selection.converted_from ?? "?",
      label: c.size_selection.merchant_label,
    });
  } else if (c.size_status === "unknown" && sizing !== "none") {
    badges.push({ kind: "check_sizing" });
  }

  for (const s of c.suspicions ?? []) {
    if (BADGE_SUPPRESSED_RULES.has(s.rule)) continue;
    if (!MATERIAL_RULE_RE.test(s.rule) && !MATERIAL_TOKEN_RE.test(s.evidence)) {
      continue;
    }
    const material = extractMaterialToken(s.evidence) ?? "mixed fibers";
    badges.push({ kind: "material_suspected", material });
  }

  if (params.correctedColor) {
    const listed = c.normalized?.colors?.buckets?.[0];
    badges.push({
      kind: "photo_color",
      color: params.correctedColor,
      listed,
    });
  }

  if (params.nearBudgetLifted) {
    badges.push({ kind: "near_budget_lifted" });
  }

  if (c.brand_confirmed === false) {
    badges.push({ kind: "brand_unconfirmed" });
  }

  return badges;
}

/** Stable owned strings for UI / snapshot tests. */
export function userFacingBadgeLabel(badge: FashionCuratedPickBadge): string | null {
  switch (badge.kind) {
    case "converted_size":
      return `${badge.label} — your ${badge.from}`;
    case "check_sizing":
      return "check sizing";
    case "material_suspected":
      return `may contain ${badge.material}`;
    case "photo_color":
      return badge.listed
        ? `photo shows: ${badge.color}`
        : `photo shows: ${badge.color}`;
    case "near_budget_lifted":
      return "slightly over budget";
    case "brand_unconfirmed":
      return "brand unconfirmed";
    default:
      return null;
  }
}
