/**
 * Detect stated per-item budget language ("under $50 each").
 */

const PER_ITEM_SCOPE_RE =
  /\b(?:each|per\s+item|per\s+piece|a\s+piece|per\s+accessory|apiece)\b/i;

const TOTAL_SCOPE_RE =
  /\b(?:for\s+the\s+whole|for\s+the\s+(?:full\s+)?(?:look|outfit|set)|across\s+all|all\s+(?:in|together)|total)\b/i;

export function inferBudgetScopeFromText(
  text: string,
): "per_item" | "total" | undefined {
  if (!text.trim()) return undefined;
  if (PER_ITEM_SCOPE_RE.test(text)) return "per_item";
  if (TOTAL_SCOPE_RE.test(text)) return "total";
  return undefined;
}

/**
 * Merge inferred scope onto a brief when the router omitted it but the user
 * used clear per-item / total language.
 */
export function applyInferredBudgetScope<
  T extends {
    budget_context: {
      stated: boolean;
      max?: number;
      scope?: "per_item" | "total";
    };
  },
>(brief: T, userMessage: string): T {
  if (!brief.budget_context.stated || brief.budget_context.scope) return brief;
  const scope = inferBudgetScopeFromText(userMessage);
  if (!scope) return brief;
  return {
    ...brief,
    budget_context: { ...brief.budget_context, scope },
  };
}
