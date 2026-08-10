/** Client-safe heuristic palettes for mid-session color quiz chips. */

export const CLARIFICATION_PALETTE_FALLBACKS: Record<string, string[]> = {
  neutrals: ["#F2F2EE", "#CFCFC9", "#8A8A93", "#A8A29E"],
  dark: ["#0F0F12", "#1F1F24", "#3A3A42", "#5C5C66"],
  earth: ["#8A9B6E", "#C9A874", "#A0703C", "#6B5B3E"],
  cool: ["#8FA6C9", "#5C7A8A", "#3E5C50", "#23305F"],
  warm: ["#E8C4A8", "#D4A373", "#B86B4A", "#6B3A2A"],
  bold: ["#C23B22", "#E8A317", "#2E5A88", "#1B1B1E"],
  pastels: ["#F3D6E0", "#D9E7F5", "#E4F0D8", "#F7E6C8"],
  default: ["#C9B8A6", "#8FA6C9", "#6B5B3E", "#2B2B30"],
};

export function paletteFallbackForLabel(label: string): string[] {
  const l = label.toLowerCase();
  if (/dark|black|noir|charcoal|ink|midnight/.test(l)) {
    return CLARIFICATION_PALETTE_FALLBACKS.dark!;
  }
  if (/neutral|gray|grey|ivory|stone|taupe|beige|cream|white/.test(l)) {
    return CLARIFICATION_PALETTE_FALLBACKS.neutrals!;
  }
  if (/earth|olive|tan|rust|brown|khaki|sand/.test(l)) {
    return CLARIFICATION_PALETTE_FALLBACKS.earth!;
  }
  if (/cool|navy|blue|teal|green|ocean/.test(l)) {
    return CLARIFICATION_PALETTE_FALLBACKS.cool!;
  }
  if (/warm|coral|terracotta|camel|spice/.test(l)) {
    return CLARIFICATION_PALETTE_FALLBACKS.warm!;
  }
  if (/pastel|soft|light|muted/.test(l)) {
    return CLARIFICATION_PALETTE_FALLBACKS.pastels!;
  }
  if (/bold|bright|vivid|colorful|jewel/.test(l)) {
    return CLARIFICATION_PALETTE_FALLBACKS.bold!;
  }
  return CLARIFICATION_PALETTE_FALLBACKS.default!;
}
