/**
 * Build concrete catalog search phrases for shoppable direction labels.
 * Used when the model omits preview_query (server-crafted gift directions, etc.).
 */
export function inferShoppablePreviewQuery(
  label: string,
  audienceHint?: string,
): string {
  const clean = label
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "")
    .replace(/[^\w\s&'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const hint = (audienceHint ?? "").toLowerCase();
  let audience = "";
  if (
    /\b(sister|mother|mom|wife|girlfriend|her|woman|women|female|daughter|aunt|grandma|nana|girl)\b/.test(
      hint,
    )
  ) {
    audience = "women's";
  } else if (
    /\b(brother|father|dad|husband|boyfriend|him|man|men|male|son|uncle|grandpa|boy)\b/.test(
      hint,
    )
  ) {
    audience = "men's";
  }

  return [audience, clean].filter(Boolean).join(" ").trim();
}
