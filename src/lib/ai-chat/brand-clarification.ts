import { prisma } from "./db";
import type { ClarificationQuestion } from "./types";
import { detectShoppingCategoryFromQuery } from "./shopping-memory/category-detector";
import { textMentionsKnownBrand } from "./shopping-mode/detector";

/** Categories where brand preference materially improves catalog search. */
const BRAND_RELEVANT_CATEGORIES = new Set([
  "shoes",
  "fashion",
  "bags",
  "beauty",
  "perfume",
  "tech",
  "watches",
  "jewelry",
  "eyewear",
  "fitness",
  "supplements",
]);

const BRAND_QUESTION_IDS = new Set([
  "brands",
  "brand",
  "brand_preference",
  "brand_preferences",
  "preferred_brands",
  "favorite_brands",
]);

/** Popular shoppable brands per category — chips only; user can type others. */
const CATEGORY_BRAND_SUGGESTIONS: Record<string, string[]> = {
  shoes: ["Nike", "Adidas", "New Balance", "On", "Hoka", "Brooks"],
  fashion: ["Uniqlo", "Zara", "Patagonia", "Everlane", "Nike", "Levi's"],
  bags: ["Coach", "Tumi", "Away", "Longchamp", "Herschel"],
  beauty: ["The Ordinary", "CeraVe", "La Roche-Posay", "Fenty", "Drunk Elephant"],
  perfume: ["Le Labo", "Diptyque", "Maison Margiela", "Tom Ford", "Byredo"],
  tech: ["Apple", "Sony", "Samsung", "Bose", "Anker"],
  watches: ["Casio", "Seiko", "Citizen", "Garmin", "Apple"],
  jewelry: ["Mejuri", "Pandora", "Tiffany", "Cartier"],
  eyewear: ["Ray-Ban", "Oakley", "Warby Parker", "Persol"],
  fitness: ["Lululemon", "Nike", "Gymshark", "Under Armour", "Rogue"],
  supplements: ["Thorne", "Momentous", "Optimum Nutrition", "AG1", "Garden of Life"],
};

function slugBrandId(label: string): string {
  return label
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
}

export function isBrandClarificationQuestion(q: Pick<ClarificationQuestion, "id">): boolean {
  const id = q.id.toLowerCase();
  if (BRAND_QUESTION_IDS.has(id)) return true;
  return id.includes("brand");
}

export function categoryBenefitsFromBrandQuestion(categories: string[]): boolean {
  return categories.some((c) => BRAND_RELEVANT_CATEGORIES.has(c));
}

function suggestedBrandLabels(categories: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const cat of categories) {
    for (const label of CATEGORY_BRAND_SUGGESTIONS[cat] ?? []) {
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(label);
      if (out.length >= 6) return out;
    }
  }
  return out;
}

export function buildBrandClarificationQuestion(
  categories: string[],
): ClarificationQuestion {
  const labels = suggestedBrandLabels(categories);
  const options = [
    { id: "open_to_any", label: "Open to any brand" },
    ...labels.map((label) => ({ id: slugBrandId(label), label })),
  ];

  return {
    id: "brands",
    prompt: "Any brands you prefer, want to try, or want to avoid?",
    optional: true,
    allowOther: true,
    allowMultiple: true,
    inputType: "options",
    options,
  };
}

async function userHasStoredBrandLoves(userId: string): Promise<boolean> {
  const row = await prisma.brandPreference.findFirst({
    where: { userId, sentiment: "love" },
    select: { id: true },
  });
  return Boolean(row);
}

/**
 * When the mid-session quiz runs for a brand-sensitive category and the user
 * hasn't named or stored brand prefs, append an optional brand question.
 */
export async function ensureBrandClarificationQuestion(params: {
  userId: string;
  queryHint: string;
  questions: ClarificationQuestion[];
}): Promise<ClarificationQuestion[]> {
  const { userId, queryHint, questions } = params;
  if (questions.some(isBrandClarificationQuestion)) return questions;
  if (questions.length >= 6) return questions;

  const hint = queryHint.trim();
  if (!hint || textMentionsKnownBrand(hint)) return questions;

  const categories = detectShoppingCategoryFromQuery(hint);
  if (!categoryBenefitsFromBrandQuestion(categories)) return questions;

  if (await userHasStoredBrandLoves(userId)) return questions;

  return [...questions, buildBrandClarificationQuestion(categories)];
}
