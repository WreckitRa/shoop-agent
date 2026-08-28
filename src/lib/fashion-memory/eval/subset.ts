import type { Persona } from "./persona";

export function personaCellKey(p: Persona): string {
  return `${p.profile.state}×${p.truth.request_type}`;
}

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Stratified sample across profile.state × request_type cells.
 * Round-robin from shuffled cells until N personas are picked.
 */
export function stratifiedSubset(
  personas: Persona[],
  n: number,
  seed: number,
): Persona[] {
  if (n <= 0) return [];
  if (n >= personas.length) return [...personas];

  const byCell = new Map<string, Persona[]>();
  for (const p of personas) {
    const key = personaCellKey(p);
    const arr = byCell.get(key) ?? [];
    arr.push(p);
    byCell.set(key, arr);
  }

  const rand = mulberry32(seed);
  const cellKeys = [...byCell.keys()].sort((a, b) => a.localeCompare(b));
  for (let i = cellKeys.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [cellKeys[i], cellKeys[j]] = [cellKeys[j]!, cellKeys[i]!];
  }

  const picked: Persona[] = [];
  const pickedIds = new Set<string>();
  while (picked.length < n) {
    let added = false;
    for (const key of cellKeys) {
      if (picked.length >= n) break;
      const pool = byCell.get(key) ?? [];
      const next = pool.find((p) => !pickedIds.has(p.id));
      if (!next) continue;
      picked.push(next);
      pickedIds.add(next.id);
      added = true;
    }
    if (!added) break;
  }
  return picked;
}
