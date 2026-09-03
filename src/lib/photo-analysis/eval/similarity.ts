export function tokenSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .filter((t) => t.length > 2),
  );
}

export function tokenJaccard(a: string, b: string): number {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / (A.size + B.size - inter);
}

export function pairwiseMatrix(
  labels: string[],
  texts: string[],
): Record<string, Record<string, number>> {
  const rows: Record<string, Record<string, number>> = {};
  for (let i = 0; i < labels.length; i++) {
    const row: Record<string, number> = {};
    for (let j = 0; j < labels.length; j++) {
      row[labels[j]!] = Number(
        tokenJaccard(texts[i] ?? "", texts[j] ?? "").toFixed(3),
      );
    }
    rows[labels[i]!] = row;
  }
  return rows;
}

export function maxOffDiagonal(
  matrix: Record<string, Record<string, number>>,
): number {
  let max = 0;
  const labels = Object.keys(matrix);
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const n = matrix[labels[i]!]?.[labels[j]!] ?? 0;
      if (n > max) max = n;
    }
  }
  return max;
}

/** Fail the generated-verdict similarity check above this (JSON fixtures are not scored). */
export const GENERATED_SIMILARITY_MAX = 0.35;
