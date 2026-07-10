/**
 * Category-keyed expertise precedents — the taste layer corpus.
 * Seeding target: ~30 Flusser-grade principles across top query categories.
 */
import { detectShoppingCategoryFromQuery } from "../shopping-memory/category-detector";

export type ExpertisePrecedent = {
  category: string;
  /** Premise-checks and judgment rules — wired to judge + narrator. */
  principles: string[];
  precedents: string[];
};

const CORPUS: ExpertisePrecedent[] = [
  {
    category: "fashion",
    principles: [
      "Office blazers: navy and charcoal are the business defaults; black reads evening unless the buyer's work is nightlife/events — then black is correct.",
      "Structure beats brand for work-to-night: shoulder line and lapel roll matter more than logo.",
      "Fabric weight signals formality: tropical wool/linen skew casual; worsted wool and ponte read office-durable.",
      "Slim vs structured: default to the buyer's stored top fit (slim/relaxed) — never ask them to choose at the end.",
      "A black blazer must read black in title, color option, or attributes — navy stripe is not black.",
      "Stretch ponte survives long sets and travel; wrinkle resistance matters more than 'luxury hand' for working buyers.",
      "Vintage stand-collar and fashion silhouettes are statements, not workhorses — Wait unless they want a second blazer.",
      "Women's cuts on men's queries are automatic drops for self-shopping, even when color matches.",
    ],
    precedents: [
      "DJ/nightlife buyer + black blazer: premise-check that black is risky in classic office but right for booth work.",
      "Beige/white blazers on black queries: auto-drop regardless of tier score.",
      "Single-size clearance (e.g. 36 S only) fails tier-1 for size-M buyers.",
      "Small-n 5.0★ (<30 reviews) is weak evidence vs thousands at 4.3★.",
      "Rack with only no-name long-tail reads as dropshipping — need 1–2 anchor brands for trust.",
    ],
  },
  {
    category: "footwear",
    principles: [
      "Road vs trail is non-negotiable — match cushion/stack to stated use before aesthetics.",
      "Running: rotate brands by gait need; popularity ≠ fit for this foot.",
      "Dress shoes: leather sole vs rubber sole changes the occasion — default to buyer's work environment.",
      "Default to stored shoe size system (US/EU) — do not ask EU vs US at the end.",
      "Half-size availability matters; verify exact size, not product family.",
    ],
    precedents: [
      "Marathon query + fashion sneaker: drop regardless of similarity score.",
      "4.9★ with 12 reviews on shoes: Wait at best — foot comfort needs volume signal.",
    ],
  },
  {
    category: "tech",
    principles: [
      "Ecosystem lock-in is a feature for Apple/Samsung households — don't cross-ecosystem without a reason.",
      "Refurb/open-box only when buyer signals value-first or risk tolerance.",
      "Spec-sheet recitation is Amazon; verdict is whether this replaces what they own.",
      "Anchor brands (Apple, Sony, Bose) buy trust; no-name only as gem with explicit tradeoff.",
    ],
    precedents: [
      "iPhone case search + buyer owns iPhone 15: search that exact generation, not generic.",
    ],
  },
  {
    category: "beauty",
    principles: [
      "Fragrance and skin actives: dupes are fine; mislabeled concentration is not.",
      "SPF is non-negotiable in daytime routines — factor climate and skin type from profile.",
      "Dermatologist-trusted anchors (CeraVe, La Roche-Posay) beat influencer brands for sensitive skin.",
      "Sample/travel size is Wait for daily drivers unless they asked to try.",
    ],
    precedents: [
      "Retinol + sensitive skin in profile: downgrade actives-heavy picks to Wait.",
    ],
  },
  {
    category: "home",
    principles: [
      "Kitchen: weight and heat retention beat aesthetics for daily drivers.",
      "Bedding: thread-count marketing lies — material (percale vs sateen) and return policy matter.",
      "Furniture: delivery timeline and assembly are part of the verdict, not footnotes.",
      "One anchor (Le Creuset, KitchenAid, Dyson) + one value alternative is the credible rack shape.",
    ],
    precedents: [
      "Cast iron vs nonstick for novice cook: Buy one workhorse, Wait on duplicate pans.",
    ],
  },
  {
    category: "gifts",
    principles: [
      "Gift fit = would the recipient recognize this as thoughtful for the lane, not catalog rank.",
      "Never recommend gift merch (boxes, novelty mugs) when searching for real products.",
      "Verdict names the recipient relationship — 'for your wife who hikes' not 'great reviews'.",
      "When budget is soft, one over-budget gem is Wait unless they explicitly want to splurge.",
      "Age-appropriate beats trendy for family gifts — check recipient age range in profile.",
    ],
    precedents: [
      "Anniversary + kitchen lane: three picks must all read as kitchen, not mixed categories.",
    ],
  },
];

function matchCorpus(query: string, category?: string): ExpertisePrecedent | null {
  const detected = detectShoppingCategoryFromQuery(query);
  const cats = [
    category?.toLowerCase(),
    ...detected.map((c) => c.toLowerCase()),
    query.toLowerCase(),
  ].filter(Boolean) as string[];

  for (const entry of CORPUS) {
    const key = entry.category.toLowerCase();
    if (cats.some((c) => c.includes(key) || key.includes(c))) return entry;
  }

  if (/\bblazer|jacket|suit|apparel|clothing|shirt|pants\b/i.test(query)) {
    return CORPUS.find((e) => e.category === "fashion") ?? null;
  }
  if (/\bshoe|sneaker|boot|trainer\b/i.test(query)) {
    return CORPUS.find((e) => e.category === "footwear") ?? null;
  }
  if (/\bphone|laptop|headphone|earbud|tablet|monitor\b/i.test(query)) {
    return CORPUS.find((e) => e.category === "tech") ?? null;
  }
  if (/\bskincare|serum|moisturizer|perfume|makeup\b/i.test(query)) {
    return CORPUS.find((e) => e.category === "beauty") ?? null;
  }
  if (/\bkitchen|bedding|furniture|vacuum|cookware\b/i.test(query)) {
    return CORPUS.find((e) => e.category === "home") ?? null;
  }
  if (/\bgift|present|birthday|anniversary\b/i.test(query)) {
    return CORPUS.find((e) => e.category === "gifts") ?? null;
  }
  return null;
}

export function getExpertisePrinciplesForNarrator(
  query: string,
  category?: string,
  limit = 6,
): string[] {
  const entry = matchCorpus(query, category);
  return (entry?.principles ?? []).slice(0, limit);
}

export function formatExpertiseCorpus(
  query: string,
  category?: string,
  extraPrinciples?: string[],
): string {
  const entry = matchCorpus(query, category);
  const principles = [
    ...(extraPrinciples ?? []),
    ...(entry?.principles ?? [
      "Judge product attributes and silhouette against the request, not catalog rank.",
      "Tier 1 requires feature-citing reasons; if you cannot write one, downgrade.",
      "Take a position — Buy, Wait, or Don't. Safe option-presentation is not Shoop.",
    ]),
  ];
  const precedents = entry?.precedents ?? [];
  const principlesBlock = `Principles you apply:\n${principles.map((p) => `- ${p}`).join("\n")}`;
  const precedentsBlock = precedents.length
    ? `Precedents you've seen:\n${precedents.map((p) => `- ${p}`).join("\n")}`
    : "Precedents you've seen:\n(none retrieved for this specialization yet)";
  return `${principlesBlock}\n\n${precedentsBlock}`;
}

/** Total seeded principles across corpus (observability). */
export function expertiseCorpusStats(): { categories: number; principles: number } {
  let principles = 0;
  for (const e of CORPUS) principles += e.principles.length;
  return { categories: CORPUS.length, principles };
}
