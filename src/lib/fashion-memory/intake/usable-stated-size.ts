/**
 * Stated size strings from the router LLM — reject placeholders so they
 * never count as answered or get written as fashion_facts.
 */
export function isUsableStatedSizeValue(raw: string | null | undefined): boolean {
  const t = raw?.trim() ?? "";
  if (!t) return false;
  const n = t.toLowerCase().replace(/[<>[\]{}()]/g, "").trim();
  if (!n) return false;
  if (
    /^(unknown|n\/?a|none|null|undefined|unspecified|not sure|idk|tbd|\?+|-+|\.+)$/i.test(
      n,
    )
  ) {
    return false;
  }
  // LLM sometimes emits the token literally: "<UNKNOWN>", "UNKNOWN", "N/A"
  if (n.includes("unknown")) return false;
  return true;
}

/** Size families the client named in free text (opening, slots, size answers). */
export function sizeFamiliesNamedInText(text: string): Set<string> {
  const named = new Set<string>();
  const u = text.toLowerCase();
  if (
    /\b(top|tops|shirt|shirts|blouse|tee|sweater|sweaters|cardigan|hoodie|blazer|jacket|coat)\b/i.test(
      u,
    )
  ) {
    named.add("tops");
  }
  if (
    /\b(bottom|bottoms|trouser|trousers|pant|pants|jeans?|chino|chinos)\b/i.test(
      u,
    )
  ) {
    named.add("bottoms");
  }
  if (
    /\b(shoe|shoes|sneaker|sneakers|boot|boots|loafer|loafers|sandal|sandals|heel|heels)\b/i.test(
      u,
    )
  ) {
    named.add("shoes");
  }
  if (/\b(dress|dresses|gown|gowns|skirt|skirts)\b/i.test(u)) {
    named.add("dresses");
  }
  return named;
}

/** Drop unusable size slots from stated_facts (mutates a shallow copy). */
export function sanitizeStatedSizes(
  sizes: {
    tops?: string;
    bottoms?: string;
    shoes?: string;
    dresses?: string;
  } | null | undefined,
): {
  tops?: string;
  bottoms?: string;
  shoes?: string;
  dresses?: string;
} | undefined {
  if (!sizes) return undefined;
  const out: {
    tops?: string;
    bottoms?: string;
    shoes?: string;
    dresses?: string;
  } = {};
  if (isUsableStatedSizeValue(sizes.tops)) out.tops = sizes.tops!.trim();
  if (isUsableStatedSizeValue(sizes.bottoms)) {
    out.bottoms = sizes.bottoms!.trim();
  }
  if (isUsableStatedSizeValue(sizes.shoes)) out.shoes = sizes.shoes!.trim();
  if (isUsableStatedSizeValue(sizes.dresses)) {
    out.dresses = sizes.dresses!.trim();
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Keep stated sizes only for families named in the conversation (or just
 * answered via size clarification). Profile sizes must not land as stated.
 */
export function clampStatedSizesToNamedFamilies(params: {
  sizes:
    | {
        tops?: string;
        bottoms?: string;
        shoes?: string;
        dresses?: string;
      }
    | null
    | undefined;
  conversationTexts: string[];
  /** Families answered on a size chip this turn. */
  answeredFamilies?: Iterable<string>;
}):
  | {
      tops?: string;
      bottoms?: string;
      shoes?: string;
      dresses?: string;
    }
  | undefined {
  if (!params.sizes) return undefined;
  const named = new Set<string>();
  for (const t of params.conversationTexts) {
    for (const f of sizeFamiliesNamedInText(t)) named.add(f);
  }
  for (const f of params.answeredFamilies ?? []) {
    const k = f.toLowerCase().trim();
    if (k) named.add(k);
  }
  if (!named.size) {
    // No family named → drop all stated sizes (profile leak).
    return undefined;
  }
  const out: {
    tops?: string;
    bottoms?: string;
    shoes?: string;
    dresses?: string;
  } = {};
  for (const bucket of ["tops", "bottoms", "shoes", "dresses"] as const) {
    const v = params.sizes[bucket];
    if (v && named.has(bucket)) out[bucket] = v;
  }
  return sanitizeStatedSizes(out);
}
