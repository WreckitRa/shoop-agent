/**
 * Classify a follow-up ready_to_search against the on-screen result.
 * Code over structured brief diffs — not utterance text, not LLM prose.
 *
 * Rescore-only = on-screen result exists + garments equal by family +
 * recipient equal + budget equal-or-looser. Occasion and request_type are
 * router labels for the same pull; string equality on them is not a
 * meaning check. Department/brand still force a full re-query.
 */
import { garmentSlotFamilyKey } from "../router/garment-family";
import type { FashionSearchBrief } from "../router/types";

export type RefinementMode = "rescore-only" | "partial" | "full";

export function garmentFamilySet(garments: string[]): Set<string> {
  return new Set(
    garments.map((g) => garmentSlotFamilyKey(g)).filter(Boolean),
  );
}

function brandsKey(
  brief: FashionSearchBrief,
): string {
  const brands = brief.brand_direction?.brands ?? [];
  return [...brands].map((b) => b.trim().toLowerCase()).sort().join("|");
}

/** True when next is a tighter cap than previous (including adding a cap). */
export function budgetTighter(
  previous: FashionSearchBrief,
  next: FashionSearchBrief,
): boolean {
  const prevMax = previous.budget_context.max;
  const nextMax = next.budget_context.max;
  if (nextMax == null) return false;
  if (prevMax == null) return true;
  return nextMax < prevMax;
}

export function budgetEqualOrLooser(
  previous: FashionSearchBrief,
  next: FashionSearchBrief,
): boolean {
  return !budgetTighter(previous, next);
}

export function familyDiff(
  previous: string[],
  next: string[],
): { onlyPrev: string[]; onlyNext: string[]; shared: string[] } {
  const prev = garmentFamilySet(previous);
  const nxt = garmentFamilySet(next);
  const onlyPrev = [...prev].filter((g) => !nxt.has(g));
  const onlyNext = [...nxt].filter((g) => !prev.has(g));
  const shared = [...prev].filter((g) => nxt.has(g));
  return { onlyPrev, onlyNext, shared };
}

/**
 * One family added, removed, or swapped (e.g. "swap the shoes").
 * Two-or-more family edits are a full re-query.
 */
export function isSingleFamilyChange(diff: {
  onlyPrev: string[];
  onlyNext: string[];
}): boolean {
  const removed = diff.onlyPrev.length;
  const added = diff.onlyNext.length;
  if (removed === 0 && added === 0) return false;
  if (removed <= 1 && added <= 1 && removed + added >= 1) return true;
  return false;
}

export function classifyRefinementMode(
  previous: FashionSearchBrief | null | undefined,
  next: FashionSearchBrief,
): RefinementMode {
  if (!previous) return "full";
  if (previous.recipient_person_id !== next.recipient_person_id) return "full";
  if (budgetTighter(previous, next)) return "full";
  const prevDept = previous.department_scope ?? previous.knowledge_state?.department;
  const nextDept = next.department_scope ?? next.knowledge_state?.department;
  if (prevDept && nextDept && prevDept !== nextDept) return "full";
  if (brandsKey(previous) !== brandsKey(next)) return "full";

  const diff = familyDiff(previous.garments, next.garments);
  if (diff.onlyPrev.length === 0 && diff.onlyNext.length === 0) {
    return "rescore-only";
  }
  if (isSingleFamilyChange(diff)) return "partial";
  return "full";
}
