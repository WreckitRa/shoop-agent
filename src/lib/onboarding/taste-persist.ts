import type { TasteCardCategory } from "@/lib/onboarding/taste-cards";
import { normalizeTasteTag } from "@/lib/onboarding/taste-tags";
import type { onboardingPatchSchema } from "@/lib/onboarding/status";
import type { z } from "zod";

export type TasteSwipeValue = "like" | "dislike" | "neutral";

export type TasteSwipeResponse = {
  cardId: string;
  swipe: TasteSwipeValue;
  tasteTags?: string[];
  productTitle?: string;
  category?: TasteCardCategory;
};

type OnboardingPatch = z.infer<typeof onboardingPatchSchema>;

const CATEGORY_FOR_MEMORY: Record<TasteCardCategory, string> = {
  outfit: "fashion",
  furniture: "home",
  tech: "electronics",
  lifestyle: "lifestyle",
  personality: "",
};

function titleTokens(title?: string): string[] {
  if (!title?.trim()) return [];
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && w.length < 24)
    .slice(0, 4);
}

/** Maps catalog swipe results → TasteTag rows (memory guide §12 visual elicitation). */
export function buildPatchFromTasteSwipes(
  responses: TasteSwipeResponse[],
): OnboardingPatch {
  const tasteTags: NonNullable<OnboardingPatch["tasteTags"]> = [];
  const seen = new Set<string>();

  for (const { cardId, swipe, tasteTags: tags, productTitle, category } of responses) {
    if (swipe === "neutral" || !cardId) continue;

    const polarity = swipe === "like" ? "positive" : "negative";
    const memoryCategory =
      category && category in CATEGORY_FOR_MEMORY
        ? CATEGORY_FOR_MEMORY[category as TasteCardCategory]
        : "";

    const tagSources = [...(tags ?? []), ...titleTokens(productTitle)];
    for (const raw of tagSources) {
      const norm = normalizeTasteTag(raw.trim().toLowerCase());
      if (!norm) continue;
      const key = `${memoryCategory}|${polarity}|${norm}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tasteTags.push({
        tag: norm,
        polarity,
        ...(memoryCategory ? { category: memoryCategory } : {}),
      });
    }
  }

  if (!tasteTags.length) return {};
  return { tasteTags };
}
