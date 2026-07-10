/** Levenshtein distance — no external dependency. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1);

  for (let i = 0; i < a.length; i++) {
    curr[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      curr[j + 1] = Math.min(
        curr[j]! + 1,
        prev[j + 1]! + 1,
        prev[j]! + cost,
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]!;
  }
  return prev[b.length]!;
}

/** Fuzzy match token to exactly one dict key within distance 1. */
export function fuzzyToken(
  token: string,
  dictKeys: string[],
): string | null {
  if (token.length < 4) return null;
  const matches: string[] = [];
  for (const key of dictKeys) {
    if (Math.abs(key.length - token.length) > 1) continue;
    if (levenshtein(token, key) <= 1) matches.push(key);
  }
  return matches.length === 1 ? matches[0]! : null;
}
