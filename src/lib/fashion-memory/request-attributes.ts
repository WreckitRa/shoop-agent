import type { RequestEventAttributes } from "./types";

/** Deterministic request attributes from a raw search query (no LLM). */
export function requestAttributesFromQuery(query: string): RequestEventAttributes {
  const q = query.trim().toLowerCase();
  const attrs: RequestEventAttributes = { raw_query: query.trim() };

  const colorMatch = q.match(
    /\b(black|white|navy|blue|red|green|beige|brown|grey|gray|pink|purple|yellow|orange|cream|olive|tan|charcoal|ivory)\b/,
  );
  if (colorMatch?.[1]) attrs.color = colorMatch[1];

  const garmentMatch = q.match(
    /\b(shirt|shirts|blazer|blazers|jacket|jackets|pants|trousers|jeans|dress|dresses|skirt|shoes|sneakers|boots|coat|sweater|hoodie|top|tops|shorts|suit|tie|belt|bag|hat)\b/,
  );
  if (garmentMatch?.[1]) attrs.garment = garmentMatch[1];

  return attrs;
}
