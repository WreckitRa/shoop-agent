import type { SimilarSearchPlan } from "./plan-similar-searches";

/** Assistant intro after find-similar results land. */
export function buildSimilarIntroText(
  seedTitle: string | string[],
  pickCount: number,
  plans?: SimilarSearchPlan[],
): string {
  const titles = (Array.isArray(seedTitle) ? seedTitle : [seedTitle])
    .map((t) => t.trim())
    .filter(Boolean);
  const multi = titles.length > 1;

  const planHint =
    plans?.length === 1 && plans[0]?.productType
      ? plans[0].productType
      : plans && plans.length > 1
        ? `${plans.length} product types`
        : null;

  if (pickCount > 0) {
    if (multi) {
      const typeBit = planHint ? ` (${planHint})` : "";
      return `I searched for alternatives similar to the ${titles.length} items you picked${typeBit} — here are ${pickCount} option${pickCount === 1 ? "" : "s"} worth a look.`;
    }
    const trimmed = titles[0] ?? "";
    const typeBit = planHint ? ` in the **${planHint}** lane` : "";
    return trimmed
      ? `I found ${pickCount} pick${pickCount === 1 ? "" : "s"} similar to *${trimmed}*${typeBit}.`
      : `Here are ${pickCount} similar pick${pickCount === 1 ? "" : "s"}.`;
  }

  if (multi) {
    return "I couldn't find close matches to those picks right now — try widening budget or shipping.";
  }
  const trimmed = titles[0] ?? "";
  return trimmed
    ? `I couldn't find close matches to *${trimmed}* right now — try widening budget or shipping.`
    : "I couldn't find close matches right now.";
}

export function buildSimilarPickReason(
  plan: SimilarSearchPlan | undefined,
  seedTitle: string,
): string {
  const rationale = plan?.searches[0]?.rationale;
  if (rationale) {
    return rationale;
  }
  return `Similar vibe to ${seedTitle.split(" ").slice(0, 5).join(" ")}`;
}
