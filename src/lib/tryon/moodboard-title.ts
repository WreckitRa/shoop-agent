/**
 * Human labels for moodboard / "TODAY, ON YOU" tiles.
 * `lookId` is often an opaque key (fitting-room:…); never show that as a title.
 */

const OPAQUE_LOOK_ID_RE =
  /^(fitting-room:|capsule:|search:|product:|image:)/i;

export function isOpaqueLookId(lookId: string): boolean {
  const id = lookId.trim();
  if (!id) return true;
  if (OPAQUE_LOOK_ID_RE.test(id)) return true;
  // Multi-ref cache keys / pipe-joined refs.
  if (id.includes("|") || id.includes(":")) return true;
  return false;
}

function titlesFromInputRefs(
  inputRefs: Record<string, unknown> | null | undefined,
): string[] {
  if (!inputRefs) return [];
  const single = inputRefs.title;
  if (typeof single === "string" && single.trim()) return [single.trim()];
  const list = inputRefs.titles;
  if (Array.isArray(list)) {
    const fromTitles = list
      .filter((t): t is string => typeof t === "string" && Boolean(t.trim()))
      .map((t) => t.trim());
    if (fromTitles.length) return fromTitles;
  }
  const garments = inputRefs.garments;
  if (Array.isArray(garments)) {
    return garments
      .filter((t): t is string => typeof t === "string" && Boolean(t.trim()))
      .map((t) => t.trim());
  }
  return [];
}

export function moodboardDisplayTitle(params: {
  kind: "item" | "look";
  lookId?: string | null;
  inputRefs?: Record<string, unknown> | null;
}): string {
  const fromRefs = titlesFromInputRefs(params.inputRefs);
  if (fromRefs.length === 1) return fromRefs[0]!;
  if (fromRefs.length === 2) return fromRefs.join(" · ");
  if (fromRefs.length > 2) {
    return `${fromRefs[0]} + ${fromRefs.length - 1} more`;
  }

  const lookId = params.lookId?.trim();
  if (lookId && !isOpaqueLookId(lookId)) return lookId;

  return params.kind === "look" ? "Saved look" : "Saved try-on";
}
