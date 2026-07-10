export type CategoryMarqueeExperience = "fill" | "compact" | "marquee";

/**
 * - `marquee`: desktop — auto-scroll + lens effect
 * - `compact`: phone — CSS auto-scroll only (tiles always span the row)
 * - `fill`: reduced motion — static row, categories stretch to full width
 */
export function resolveCategoryMarqueeExperience(): CategoryMarqueeExperience {
  if (typeof window === "undefined") return "compact";

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return "fill";
  }

  if (window.matchMedia("(max-width: 767px)").matches) {
    return "compact";
  }

  if (window.matchMedia("(hover: none) and (pointer: coarse)").matches) {
    return "compact";
  }

  return "marquee";
}

export function categoryMarqueeCopies(
  experience: CategoryMarqueeExperience,
): number {
  switch (experience) {
    case "marquee":
      return 4;
    case "compact":
      return 3;
    case "fill":
      return 1;
  }
}

export function categoryMarqueeDurationS(
  experience: CategoryMarqueeExperience,
): number {
  return experience === "compact" ? 72 : 96;
}
