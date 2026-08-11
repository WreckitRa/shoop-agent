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
