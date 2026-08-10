/**
 * L6 composition invariants — header from contents, no unverified on the live
 * rack, no duplicate UPIDs in a turn. Failures are attributable here, not to
 * scoring or the curator prompt.
 */
import { resolveGarmentFamily } from "../hard-drops/item-type";
import { resolveSwimSubtype } from "../hard-drops/swimwear";

export type PresentationItem = {
  id?: string;
  ref?: string;
  title?: string;
  garment: string;
  slot_id?: string;
};

/** Short / empty bench copy — never invent backfill language. */
export function shortBenchThinNote(params: {
  eligibleCount: number;
  garmentLabel: string;
}): string | undefined {
  const label = params.garmentLabel.trim() || "this ask";
  if (params.eligibleCount <= 0) {
    return `Nothing solid for ${label} came through from stores I can reach — want me to widen one constraint?`;
  }
  if (params.eligibleCount <= 2) {
    return `Only ${params.eligibleCount} true ${label} came back. Showing what matches — not padding the rail.`;
  }
  return undefined;
}

/**
 * Header must not claim a construction the contents contradict (e.g. "two-piece"
 * over one-piece titles). Returns mismatch evidence strings (empty = ok).
 */
export function headerContentMismatches(
  items: PresentationItem[],
): string[] {
  const out: string[] = [];
  for (const item of items) {
    const title = item.title?.trim();
    if (!title) continue;

    const headerSubtype = resolveSwimSubtype(item.garment);
    const titleSubtype = resolveSwimSubtype(title);
    if (headerSubtype && titleSubtype && headerSubtype !== titleSubtype) {
      out.push(
        `${item.garment} header vs title "${title}" (${titleSubtype})`,
      );
    }

    const headerFamily = resolveGarmentFamily(item.garment)?.family;
    const titleFamily = resolveGarmentFamily(title)?.family;
    if (headerFamily && titleFamily && headerFamily !== titleFamily) {
      out.push(
        `${item.garment} header vs title "${title}" (${titleFamily})`,
      );
    }
  }
  return out;
}

/** Duplicate product ids / refs across the rendered set. */
export function duplicateIdsInTurn(items: PresentationItem[]): string[] {
  const seen = new Set<string>();
  const dups: string[] = [];
  for (const item of items) {
    const key = (item.id || item.ref || "").trim();
    if (!key) continue;
    if (seen.has(key)) dups.push(key);
    else seen.add(key);
  }
  return dups;
}
