/** Client-safe heuristic palettes for mid-session color quiz chips. */

function hexLum(hex: string): number {
  const h = hex.replace("#", "");
  if (h.length !== 6) return 0.5;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function meanPaletteLuminance(colors: string[]): number {
  if (!colors.length) return 0.5;
  return colors.reduce((s, c) => s + hexLum(c), 0) / colors.length;
}

/**
 * Fashion-true swatches — Neutral must read ivory/stone (not muddy mid-grey),
 * Dark must read near-black. Client interim dots + LLM-failure / reject fallback
 * only — never the emit-time source of truth (LLM + cache owns that).
 */
export const CLARIFICATION_PALETTE_FALLBACKS: Record<string, string[]> = {
  /** Ivory → stone → greige → soft taupe (all light/mid-light). */
  cream: ["#f7f3eb", "#ebe4d8", "#d9d0c2", "#c9b8a6"],
  /** Same family as cream — "Neutral tones" quiz chip. */
  neutrals: ["#f5f2eb", "#e5e0d6", "#cfc7ba", "#b5a99a"],
  charcoal: ["#141418", "#25252c", "#3c3c44", "#585860"],
  dark: ["#0c0c0f", "#1a1a20", "#2e2e36", "#484850"],
  taupe: ["#d4c4b0", "#bba892", "#9a8a74", "#7a6c5a"],
  earth: ["#8a9b6e", "#c9a874", "#a0703c", "#6b5b3e"],
  cool: ["#8fa6c9", "#5c7a8a", "#3e5c50", "#23305f"],
  warm: ["#e8c4a8", "#d4a373", "#b86b4a", "#6b3a2a"],
  bold: ["#c23b22", "#e8a317", "#2e5a88", "#1b1b1e"],
  pastels: ["#f3d6e0", "#d9e7f5", "#e4f0d8", "#f7e6c8"],
  default: ["#c9b8a6", "#8fa6c9", "#6b5b3e", "#2b2b30"],
};

export function paletteFallbackForLabel(label: string): string[] {
  const l = label.toLowerCase();
  if (/charcoal|dark\s*grey|dark\s*gray|noir|ink|midnight|\bblack\b/.test(l)) {
    return [...CLARIFICATION_PALETTE_FALLBACKS.charcoal!];
  }
  if (/\bdark\b/.test(l)) {
    return [...CLARIFICATION_PALETTE_FALLBACKS.dark!];
  }
  if (/cream|off[\s-]?white|ivory|light\s*grey|light\s*gray/.test(l)) {
    return [...CLARIFICATION_PALETTE_FALLBACKS.cream!];
  }
  if (/taupe|beige|sand|camel|khaki/.test(l)) {
    return [...CLARIFICATION_PALETTE_FALLBACKS.taupe!];
  }
  if (/neutral|stone|greige|gray|grey|white/.test(l)) {
    return [...CLARIFICATION_PALETTE_FALLBACKS.neutrals!];
  }
  if (/earth|olive|tan|rust|brown/.test(l)) {
    return [...CLARIFICATION_PALETTE_FALLBACKS.earth!];
  }
  if (/cool|navy|blue|teal|green|ocean|slate/.test(l)) {
    return [...CLARIFICATION_PALETTE_FALLBACKS.cool!];
  }
  if (/warm|coral|terracotta|spice|cognac/.test(l)) {
    return [...CLARIFICATION_PALETTE_FALLBACKS.warm!];
  }
  if (/pastel|soft|muted/.test(l)) {
    return [...CLARIFICATION_PALETTE_FALLBACKS.pastels!];
  }
  if (/bold|bright|vivid|colorful|jewel/.test(l)) {
    return [...CLARIFICATION_PALETTE_FALLBACKS.bold!];
  }
  return [...CLARIFICATION_PALETTE_FALLBACKS.default!];
}

/**
 * Reject LLM/cache palettes that contradict the label (e.g. "Neutral tones"
 * painted as near-blacks). Caller should fall back to paletteFallbackForLabel.
 */
export function palettePlausibleForLabel(
  label: string,
  colors: string[],
): boolean {
  if (colors.length < 3) return false;
  const l = label.toLowerCase();
  const mean = meanPaletteLuminance(colors);
  const min = Math.min(...colors.map(hexLum));
  const max = Math.max(...colors.map(hexLum));

  if (/dark|black|charcoal|noir|ink|midnight/.test(l)) {
    // Dark chips must stay dark — mean luminance low.
    return mean <= 0.38 && max <= 0.55;
  }
  if (/neutral|cream|ivory|stone|greige|off[\s-]?white|light\s*gr[ae]y/.test(l)) {
    // Neutrals must stay light/mid — no near-black dots.
    return mean >= 0.55 && min >= 0.35;
  }
  if (/taupe|beige|sand|camel/.test(l)) {
    return mean >= 0.35 && mean <= 0.85;
  }
  return true;
}
