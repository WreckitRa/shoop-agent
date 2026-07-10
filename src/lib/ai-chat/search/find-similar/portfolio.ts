import type { CatalogLikeItem } from "@/lib/shopify/catalog";
import type { PortfolioQuery } from "../types";
import type { SimilarSearchContext, TasteHypothesis } from "./types";
import { findSimilarSearchQuery } from "./action";

const BRAND_STRIP = /\b(nike|adidas|gucci|prada|zara|hm|h&m|lululemon)\b/gi;

function stripBrands(text: string): string {
  return text.replace(BRAND_STRIP, "").replace(/\s+/g, " ").trim();
}

function categoryPhrase(h: TasteHypothesis | null, fallback: string): string {
  const ctx = h?.sharedContext?.[0]?.trim();
  return ctx || fallback;
}

/** Immediate seed-anchored catalog arms (product-id + optional image). */
export function buildSeedSimilarArms(params: {
  similar: SimilarSearchContext;
  imageLike: CatalogLikeItem | null;
}): PortfolioQuery[] {
  const { similar, imageLike } = params;
  const semantic = findSimilarSearchQuery(similar.seedTitle);
  const arms: PortfolioQuery[] = [
    {
      id: "similar_seed_id",
      text: "",
      wave: 1,
      like: [{ id: similar.seedProductId }],
    },
    {
      id: "similar_seed_text",
      text: semantic,
      wave: 1,
    },
  ];
  if (imageLike) {
    arms.push({
      id: "similar_seed_image",
      text: semantic,
      wave: 1,
      like: [imageLike],
    });
  }
  return arms;
}

/** Attribute-driven text arms — join when hypothesis lands. */
export function buildAttributeSimilarArms(params: {
  similar: SimilarSearchContext;
  hypothesis: TasteHypothesis;
  categoryFallback: string;
}): PortfolioQuery[] {
  const { hypothesis, categoryFallback } = params;
  const category = categoryPhrase(hypothesis, categoryFallback);
  const strong = hypothesis.differentiators
    .filter((d) => d.confidence >= 0.45)
    .sort((a, b) => b.confidence * b.weight - a.confidence * a.weight);

  const arms: PortfolioQuery[] = [];
  for (let i = 0; i < Math.min(strong.length, 3); i++) {
    const d = strong[i]!;
    const attr = stripBrands(d.attribute);
    if (!attr) continue;
    arms.push({
      id: `similar_attr_${i}`,
      text: `${category} ${attr}`.trim(),
      wave: 1,
      isDiscovery: i === strong.length - 1,
    });
  }

  const top = strong[0];
  if (top && top.confidence >= 0.6) {
    const relaxed = stripBrands(top.attribute);
    if (relaxed) {
      arms.push({
        id: "similar_attr_relaxed",
        text: relaxed,
        wave: 1,
        isDiscovery: true,
      });
    }
  }

  const weak = hypothesis.uncertain.filter((d) => d.confidence >= 0.25);
  if (weak.length && arms.length < 4) {
    const combo = weak
      .slice(0, 2)
      .map((d) => stripBrands(d.attribute))
      .filter(Boolean)
      .join(" ");
    if (combo) {
      arms.push({
        id: "similar_attr_explore",
        text: `${category} ${combo}`.trim(),
        wave: 1,
        isDiscovery: true,
      });
    }
  }

  return arms;
}

/** Best derived text when pool is thin (non-catalog fallback). */
export function buildSimilarFallbackText(
  hypothesis: TasteHypothesis | null,
  seedTitle: string,
): string {
  const top = hypothesis?.differentiators[0]?.attribute;
  if (top) return stripBrands(`${categoryPhrase(hypothesis, seedTitle)} ${top}`);
  return findSimilarSearchQuery(seedTitle);
}
