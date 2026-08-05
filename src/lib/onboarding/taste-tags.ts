/** Split free-text style fields into DB-safe taste tag strings (max 80 chars). */

export const TASTE_TAG_MAX_LENGTH = 80;

export function normalizeTasteTag(raw: string): string | null {
  const t = raw.replace(/\*\*/g, "").trim().slice(0, TASTE_TAG_MAX_LENGTH);
  return t.length >= 2 ? t : null;
}

/** Split paragraphs or comma lists into short tags for TasteTag rows. */
export function tagsFromFreeText(text: string | undefined, max = 16): string[] {
  if (!text?.trim()) return [];
  const parts = text
    .split(/[,;]|\.\s+|\n+/)
    .map((s) => normalizeTasteTag(s))
    .filter((s): s is string => Boolean(s));
  if (parts.length) return parts.slice(0, max);
  const single = normalizeTasteTag(text);
  return single ? [single] : [];
}
