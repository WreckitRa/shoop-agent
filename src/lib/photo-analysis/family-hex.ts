import type { ColorFamily } from "./style-contract";

/** Display hex when the model omitted or corrupted a swatch. Never a silent camel. */
export const FAMILY_DISPLAY_HEX: Record<ColorFamily, string> = {
  black: "#1A1A1A",
  white: "#F2E7D2",
  grey: "#6B6E73",
  beige: "#C4A574",
  brown: "#6B4226",
  navy: "#17243A",
  blue: "#3B5F8A",
  green: "#254A3B",
  olive: "#596044",
  red: "#8B2E2E",
  burgundy: "#713A43",
  pink: "#C9899A",
  purple: "#6B5A7A",
  orange: "#C46A2B",
  yellow: "#D4B44A",
  gold: "#C9A227",
  silver: "#A8AEB4",
  denim: "#3D4F6F",
  multi: "#6B6E73",
  print: "#6B6E73",
};

const SHADE_TINT: Array<{ re: RegExp; toward: "light" | "dark" }> = [
  { re: /\b(pale|light|soft|warm cream|cream|ivory)\b/i, toward: "light" },
  { re: /\b(deep|dark|ink|forest|charcoal|moss)\b/i, toward: "dark" },
];

function mix(hex: string, toward: "light" | "dark"): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const t = toward === "light" ? 0.22 : -0.18;
  const ch = (c: number) =>
    Math.max(0, Math.min(255, Math.round(c + (toward === "light" ? 255 - c : c) * t)));
  return `#${[ch(r), ch(g), ch(b)].map((c) => c.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export function isValidHex(raw: string | null | undefined): boolean {
  const h = (raw ?? "").trim();
  return /^#[0-9A-Fa-f]{6}$/.test(h) || /^#[0-9A-Fa-f]{3}$/.test(h);
}

export function parseHexOrNull(raw: string | null | undefined): string | null {
  const h = (raw ?? "").trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(h)) return h.toUpperCase();
  if (/^#[0-9A-Fa-f]{3}$/.test(h)) {
    return `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`.toUpperCase();
  }
  return null;
}

/** Legacy rows where invalid JSON was replaced with a camel swatch. */
export function isLegacySilentFallback(
  family: ColorFamily,
  hex: string | null,
): boolean {
  if (!hex) return false;
  const parsed = parseHexOrNull(hex);
  if (!parsed) return false;
  if (parseInt(parsed.slice(1), 16) !== 0xb8894f) return false;
  return family !== "beige" && family !== "brown" && family !== "gold";
}

export function displayHexForFamily(
  family: ColorFamily,
  shade = "",
): string {
  const base = FAMILY_DISPLAY_HEX[family];
  for (const row of SHADE_TINT) {
    if (row.re.test(shade)) return mix(base, row.toward);
  }
  return base;
}

export function hexForSwatch(input: {
  family: ColorFamily;
  shade: string;
  hex: string | null;
}): string {
  if (input.hex && isValidHex(input.hex) && !isLegacySilentFallback(input.family, input.hex)) {
    return parseHexOrNull(input.hex) ?? displayHexForFamily(input.family, input.shade);
  }
  return displayHexForFamily(input.family, input.shade);
}
