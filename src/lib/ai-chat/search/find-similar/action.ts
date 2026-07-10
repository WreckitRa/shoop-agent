import {
  normalizeFindSimilarSeeds,
  type FindSimilarPayload,
  type FindSimilarSeed,
} from "./types";

export function formatFindSimilarUserText(
  titleOrPayload: string | FindSimilarSeed[] | FindSimilarPayload,
): string {
  const seeds = Array.isArray(titleOrPayload)
    ? titleOrPayload
    : typeof titleOrPayload === "string"
      ? [{ productId: "", productTitle: titleOrPayload }]
      : normalizeFindSimilarSeeds(titleOrPayload);

  const titles = seeds
    .map((s) => s.productTitle.trim())
    .filter(Boolean);
  if (!titles.length) return "Find similar items";
  if (titles.length === 1) return `Find similar to ${titles[0]}`;
  if (titles.length === 2) {
    return `Find similar to ${titles[0]} and ${titles[1]}`;
  }
  return `Find similar to ${titles.slice(0, -1).join(", ")}, and ${titles[titles.length - 1]}`;
}

export function findSimilarSearchQuery(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return "similar products";
  const tokens = trimmed
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
  const tail = tokens.slice(-5).join(" ");
  return tail ? `similar ${tail}` : `similar ${trimmed.slice(0, 60)}`;
}
