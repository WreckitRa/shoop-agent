/** Normalize user text for deterministic topic-guard rules. */
export function normalizeTopicGuardInput(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/\u200b|\u200c|\u200d|\ufeff/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
