/** Shared label pre-normalization — all cache keys use this form. */
export function preNormalize(label: string): string {
  let s = label.trim().toLowerCase();
  s = s.normalize("NFD").replace(/\p{M}/gu, "");
  s = s.replace(/[/\\|–—_]+/g, " ");
  s = s.replace(/[^\p{L}\p{N}\s.]/gu, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}
