import { garmentToSizeBucket } from "../intake/garment-size-fields";
import { resolveColorDeterministic } from "./color";
import { resolveSizeDeterministic } from "./size";
import type { SizeCategory } from "./types";

export type OptionKind = "color" | "size" | "ignore";

const COLOR_NAME_RE =
  /\b(color|colour|couleur|farbe|colore)\b/i;
const SIZE_NAME_RE =
  /\b(size|taille|größe|grosse|talla|tamaño|pointure)\b/i;

export function garmentToSizeCategory(garment: string): SizeCategory {
  const bucket = garmentToSizeBucket(garment);
  if (bucket === "tops") return "tops";
  if (bucket === "bottoms") return "bottoms";
  if (bucket === "shoes") return "shoes";
  if (bucket === "dresses") return "dresses";
  if (/\b(jacket|blazer|coat|outerwear|parka|vest)\b/i.test(garment)) {
    return "outerwear";
  }
  return "general";
}

export function classifyOptionName(name: string): OptionKind | "unknown" {
  const n = name.trim().toLowerCase();
  if (COLOR_NAME_RE.test(n)) return "color";
  if (SIZE_NAME_RE.test(n)) return "size";
  return "unknown";
}

export function classifyOptionValue(
  value: string,
  category: SizeCategory,
): OptionKind {
  const color = resolveColorDeterministic(value);
  if (color.resolved) return "color";
  const size = resolveSizeDeterministic(value, category);
  if (size.resolved) return "size";
  return "ignore";
}

export function classifyVariantOption(
  name: string,
  value: string,
  category: SizeCategory,
): OptionKind {
  const byName = classifyOptionName(name);
  if (byName === "color" || byName === "size") return byName;
  return classifyOptionValue(value, category);
}
