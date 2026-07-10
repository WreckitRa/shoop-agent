import type { ProductSearchInvocation } from "../types";
import type { Archetype, RecipientKind, SearchBrief } from "../search/types";
import { detectShoppingCategoryFromQuery } from "../shopping-memory/category-detector";

/** Structured snapshot of one Shoop catalog search mission. */
export type SearchMissionSnapshot = {
  query: string;
  archetype?: Archetype;
  directionLabel?: string;
  recipientKind?: RecipientKind;
  recipientLabel?: string;
  category?: string;
  useCase?: string;
};

export function searchMissionFromBrief(brief: SearchBrief): SearchMissionSnapshot {
  return {
    query: brief.query.trim(),
    archetype: brief.archetype,
    directionLabel: brief.directionLabel?.trim() || undefined,
    recipientKind: brief.recipient.kind,
    recipientLabel: brief.recipient.label?.trim() || undefined,
    category: brief.category?.trim() || undefined,
    useCase: brief.useCase?.trim() || undefined,
  };
}

export function searchMissionFromInvocation(
  inv: ProductSearchInvocation,
): SearchMissionSnapshot {
  if (inv.mission) return inv.mission;
  const recipientKind: RecipientKind | undefined =
    inv.archetype === "gift_directed" || inv.archetype === "gift_vague"
      ? "other"
      : inv.archetype
        ? "self"
        : undefined;
  return {
    query: inv.query.trim(),
    archetype: inv.archetype,
    directionLabel: inv.directionLabel?.trim() || undefined,
    recipientKind,
  };
}

function normalizeQuery(q: string): string {
  return q
    .toLowerCase()
    .replace(/[^\w\s$./+-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function queryTokens(q: string): Set<string> {
  return new Set(
    normalizeQuery(q)
      .split(" ")
      .filter((t) => t.length > 2),
  );
}

function tokenOverlap(a: string, b: string): number {
  const ta = queryTokens(a);
  const tb = queryTokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / Math.min(ta.size, tb.size);
}

function missionCategories(m: SearchMissionSnapshot): string[] {
  const blob = [m.query, m.category, m.useCase, m.directionLabel]
    .filter(Boolean)
    .join(" ");
  return detectShoppingCategoryFromQuery(blob);
}

export type FastPathDecision = {
  split: boolean;
  reason: string;
  suggestedTitle?: string;
};

/**
 * Deterministic compare — returns a decision when obvious, null when LLM should decide.
 */
export function fastPathSearchMissionDecision(
  previous: SearchMissionSnapshot,
  current: SearchMissionSnapshot,
): FastPathDecision | null {
  const prevQ = normalizeQuery(previous.query);
  const currQ = normalizeQuery(current.query);
  if (prevQ && currQ && prevQ === currQ) {
    return { split: false, reason: "same_query" };
  }

  if (
    previous.directionLabel &&
    current.directionLabel &&
    previous.directionLabel === current.directionLabel
  ) {
    return { split: false, reason: "same_gift_direction" };
  }

  if (previous.recipientKind === "other" && current.recipientKind === "self") {
    return {
      split: true,
      reason: "gift_recipient_to_self",
      suggestedTitle: deriveBranchTitleFromQuery(current.query),
    };
  }

  if (
    previous.recipientKind === "other" &&
    current.recipientKind === "other" &&
    previous.recipientLabel &&
    current.recipientLabel &&
    previous.recipientLabel.toLowerCase() !==
      current.recipientLabel.toLowerCase()
  ) {
    return {
      split: true,
      reason: "different_gift_recipient",
      suggestedTitle:
        current.directionLabel?.trim() ||
        deriveBranchTitleFromQuery(current.query),
    };
  }

  const prevCats = new Set(missionCategories(previous));
  const currCats = missionCategories(current);
  const catsDisjoint =
    prevCats.size > 0 &&
    currCats.length > 0 &&
    !currCats.some((c) => prevCats.has(c));
  if (catsDisjoint) {
    return {
      split: true,
      reason: "disjoint_categories",
      suggestedTitle: deriveBranchTitleFromQuery(current.query),
    };
  }

  if (
    previous.category &&
    current.category &&
    previous.category === current.category &&
    tokenOverlap(previous.query, current.query) >= 0.25
  ) {
    return { split: false, reason: "same_category_related_query" };
  }

  if (tokenOverlap(previous.query, current.query) >= 0.55) {
    return { split: false, reason: "high_query_overlap" };
  }

  return null;
}

export function deriveBranchTitleFromQuery(query: string): string {
  const cleaned = query
    .trim()
    .replace(/^(?:i\s+(?:want|need|'m looking for)|looking for)\s+/i, "");
  const first = cleaned.split(/[.!?\n]/)[0]?.trim() ?? cleaned;
  const title = first.slice(0, 50).trim();
  return title.length >= 3 ? title : "New search";
}

export function formatMissionForPrompt(m: SearchMissionSnapshot): string {
  return JSON.stringify(
    {
      query: m.query,
      archetype: m.archetype ?? null,
      direction: m.directionLabel ?? null,
      recipient: m.recipientKind ?? null,
      recipient_label: m.recipientLabel ?? null,
      category: m.category ?? null,
      use_case: m.useCase ?? null,
    },
    null,
    2,
  );
}
