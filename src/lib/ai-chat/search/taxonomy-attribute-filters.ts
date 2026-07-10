/**
 * Layer 1 — Shopify taxonomy attribute prefilters for `search_catalog`.
 *
 * Recall-improving soft filter only: applied on one primary portfolio query,
 * never used as a post-retrieval hard exclude. Mis-inferred catalog attributes
 * simply won't surface on that wave; other waves still run unfiltered.
 */
import type { CatalogTaxonomyAttributeFilter } from "@/lib/shopify/catalog";
import {
  chestFromToken,
  expandRequestedSizeTokens,
  letterForChest,
  normalizeLetter,
} from "./size-resolution";
import type { SearchBrief } from "./types";

function targetGenderValues(
  scope: SearchBrief["genderScope"],
): string[] {
  switch (scope) {
    case "mens":
      return ["Male"];
    case "womens":
      return ["Female"];
    case "unisex":
      return ["Unisex"];
    default:
      return [];
  }
}

/** Build optional `filters.attributes` from brief constraints (max 3 entries). */
export function buildTaxonomyAttributeFilters(
  brief: SearchBrief,
): CatalogTaxonomyAttributeFilter[] | undefined {
  const entries: CatalogTaxonomyAttributeFilter[] = [];

  const sizeRaw = brief.variantConstraints?.size?.trim();
  if (sizeRaw) {
    const parsed = expandRequestedSizeTokens(sizeRaw);
    const values = new Set<string>();
    for (const token of parsed.tokens) {
      const letter = normalizeLetter(token);
      if (letter) {
        values.add(letter.toUpperCase());
        continue;
      }
      const chest = chestFromToken(token) ?? parsed.chest;
      if (chest != null) {
        values.add(String(chest));
        const mapped = letterForChest(chest);
        if (mapped) values.add(mapped.toUpperCase());
      }
    }
    if (values.size) {
      entries.push({ name: "Size", values: [...values].slice(0, 50) });
    }
  }

  const color = brief.variantConstraints?.color?.trim();
  if (color) {
    entries.push({ name: "Color", values: [color] });
  }

  const gender = targetGenderValues(brief.genderScope);
  if (gender.length) {
    entries.push({ name: "Target gender", values: gender });
  }

  return entries.length ? entries : undefined;
}
