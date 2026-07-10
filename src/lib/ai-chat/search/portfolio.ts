/**
 * Stage 1 — Query Portfolio Construction (docs/search-improvements.md §6).
 *
 * Breadth beats depth: fan out several LLM-planned queries (query-planner.ts)
 * plus optional learned DB angles, then merge and cap by archetype budget.
 */
import {
  dedupePortfolioByText,
  portfolioBudget,
  portfolioQueryFromText,
} from "./portfolio-planner-shared";
import type { Archetype, PortfolioQuery, SearchBrief } from "./types";

export { craftPortfolioQueries } from "./query-planner";

export function learnedAngleQueries(
  brief: SearchBrief,
  texts: string[],
): PortfolioQuery[] {
  return dedupePortfolioByText(
    texts
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      .slice(0, 3)
      .map((t) =>
        portfolioQueryFromText(brief, t, { wave: 1, intent: "learned angle" }),
      )
      .filter((q): q is PortfolioQuery => q != null),
  );
}

/**
 * Merge planned (Haiku) queries with optional learned backfill.
 * Planned queries always win slots; learned angles only fill shortfalls so
 * unrelated historical yields cannot displace the current brief's plan.
 */
export function mergePortfolio(
  learned: PortfolioQuery[],
  planned: PortfolioQuery[],
  archetype: Archetype,
  directionLabel?: string,
): PortfolioQuery[] {
  const { max } = portfolioBudget(archetype, directionLabel);
  const head: PortfolioQuery[] = [];
  const seen = new Set<string>();

  const push = (q: PortfolioQuery) => {
    const k = q.text.trim().toLowerCase();
    if (!k || seen.has(k)) return;
    seen.add(k);
    head.push(q);
  };

  for (const q of planned) {
    if (head.length >= max) break;
    push(q);
  }

  for (const q of learned) {
    if (head.length >= max) break;
    push(q);
  }

  const discovery = planned.find((q) => q.isDiscovery);
  if (discovery && !head.some((q) => q.id === discovery.id)) {
    if (head.length >= max) head[head.length - 1] = discovery;
    else push(discovery);
  }

  return head;
}

export function isGiftArchetype(brief: SearchBrief): boolean {
  return brief.archetype === "gift_directed" || brief.archetype === "gift_vague";
}
