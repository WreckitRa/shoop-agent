/** Deterministic shuffle + tile aspect for onboarding style photos. */

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Same seed → same order. Used so each shopper gets a stable mix of style photos. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const out = [...items];
  let a = hashSeed(seed);
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

const STYLE_TILE_ASPECTS = ["3/4", "4/5", "1/1", "2/3", "5/6"] as const;

/** Varied crop so the style rail reads as a puzzle, not a uniform grid. */
export function styleTileAspect(
  id: string,
): (typeof STYLE_TILE_ASPECTS)[number] {
  return STYLE_TILE_ASPECTS[hashSeed(id) % STYLE_TILE_ASPECTS.length]!;
}
