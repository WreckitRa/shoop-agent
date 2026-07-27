import type { TasteCardCategory } from "@/lib/onboarding/taste-cards";
import { normalizeTasteTag } from "@/lib/onboarding/taste-tags";
import { computeStyleMix } from "@/lib/onboarding/style-mix";
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

export type OutfitPick = {
  id: string;
  label: string;
  tasteTags?: string[];
  productTitle?: string;
  productId?: string;
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

function pushPickTags(
  tasteTags: NonNullable<OnboardingPatch["tasteTags"]>,
  seen: Set<string>,
  picks: OutfitPick[],
  category: string,
) {
  for (const pick of picks) {
    const sources = [
      pick.label,
      ...(pick.tasteTags ?? []),
      ...titleTokens(pick.productTitle),
    ];
    for (const raw of sources) {
      const norm = normalizeTasteTag(raw.trim().toLowerCase());
      if (!norm) continue;
      const key = `${category}|positive|${norm}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tasteTags.push({ tag: norm, polarity: "positive", category });
    }
  }
}

/** Maps worn/aspirational picks + brands/vetoes/compliments/honesty → onboarding patch. */
export function buildPatchFromTastePicks(input: {
  wornPicks?: OutfitPick[];
  aspirationalPicks?: OutfitPick[];
  brandLikes?: string[];
  brandAvoids?: string[];
  hardAvoids?: string[];
  compliments?: string[];
  honestyPreference?: string | null;
  valuePhilosophy?: string | null;
}): OnboardingPatch {
  const tasteTags: NonNullable<OnboardingPatch["tasteTags"]> = [];
  const seen = new Set<string>();

  pushPickTags(tasteTags, seen, input.wornPicks ?? [], "worn");
  pushPickTags(tasteTags, seen, input.aspirationalPicks ?? [], "aspirational");

  for (const c of input.compliments ?? []) {
    const norm = normalizeTasteTag(c.trim().toLowerCase());
    if (!norm) continue;
    const key = `compliment|positive|${norm}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tasteTags.push({ tag: norm, polarity: "positive", category: "compliment" });
  }

  const brands: NonNullable<OnboardingPatch["brands"]> = [];
  for (const brand of input.brandLikes ?? []) {
    const b = brand.trim();
    if (!b) continue;
    brands.push({ brand: b.slice(0, 120), sentiment: "love" });
  }
  for (const brand of input.brandAvoids ?? []) {
    const b = brand.trim();
    if (!b) continue;
    brands.push({ brand: b.slice(0, 120), sentiment: "avoid" });
  }

  const hardNegatives: NonNullable<OnboardingPatch["hardNegatives"]> = [];
  for (const value of input.hardAvoids ?? []) {
    const v = value.trim();
    if (!v) continue;
    hardNegatives.push({
      scope: "style",
      value: v.slice(0, 120),
      reason: "taste",
    });
  }

  const styleMix = computeStyleMix({
    wornLabels: (input.wornPicks ?? []).map((p) => p.label),
    aspirationalLabels: (input.aspirationalPicks ?? []).map((p) => p.label),
    compliments: input.compliments ?? [],
    tasteTags: tasteTags.map((t) => t.tag),
  });

  const profile: NonNullable<OnboardingPatch["profile"]> = {
    styleMix,
    complimentPreferences: (input.compliments ?? []).slice(0, 4),
  };
  if (input.honestyPreference?.trim()) {
    profile.honestyPreference = input.honestyPreference.trim();
  }
  if (input.valuePhilosophy?.trim()) {
    profile.valuePhilosophy = input.valuePhilosophy.trim();
  }

  return {
    profile,
    ...(tasteTags.length ? { tasteTags } : {}),
    ...(brands.length ? { brands } : {}),
    ...(hardNegatives.length ? { hardNegatives } : {}),
  };
}
