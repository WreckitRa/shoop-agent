/**
 * Shoop design tokens — Fitting-room look (find → try → decide).
 * Keep in sync with `tailwind.config.ts` and `globals.css` `:root`.
 */

export const colors = {
  brand: "#E42831",
  brandSoft: "#FDECEC",
  ink: "#0E0E11",
  inkSoft: "#1A1A1E",
  inkSecondary: "#4B5563",
  inkMuted: "#8A8A93",
  page: "#F5F5F7",
  pageWarm: "#FFFFFF",
  surface: "#FFFFFF",
  surfaceSubtle: "#FBFBFC",
  surfaceTint: "#F4F4F6",
  hairline: "#E8E8EC",
  hairlineSoft: "#F0F0F3",
  success: "#2BB673",
  successSoft: "#EDF7F1",
  warning: "#B45309",
  warningSoft: "#FBF7E9",
} as const;

/** Flat map for Tailwind `theme.extend.colors` (no nesting). */
export const tailwindThemeColors = {
  brand: colors.brand,
  "brand-soft": colors.brandSoft,
  ink: colors.ink,
  "ink-soft": colors.inkSoft,
  "ink-secondary": colors.inkSecondary,
  "ink-muted": colors.inkMuted,
  page: colors.page,
  "page-warm": colors.pageWarm,
  surface: colors.surface,
  "surface-subtle": colors.surfaceSubtle,
  "surface-tint": colors.surfaceTint,
  hairline: colors.hairline,
  "hairline-soft": colors.hairlineSoft,
  success: colors.success,
  "success-soft": colors.successSoft,
  warning: colors.warning,
  "warning-soft": colors.warningSoft,
  background: colors.pageWarm,
  foreground: colors.ink,
  card: colors.surface,
  "card-foreground": colors.ink,
  popover: colors.surface,
  "popover-foreground": colors.ink,
  primary: colors.ink,
  "primary-foreground": "#ffffff",
  secondary: colors.surfaceTint,
  "secondary-foreground": colors.ink,
  muted: colors.surfaceTint,
  "muted-foreground": colors.inkMuted,
  accent: colors.surfaceTint,
  "accent-foreground": colors.ink,
  destructive: colors.brand,
  "destructive-foreground": "#ffffff",
  border: colors.hairline,
  input: colors.hairline,
  ring: colors.ink,
} as const;

export const radii = {
  sm: "8px",
  md: "12px",
  lg: "16px",
  xl: "20px",
  "2xl": "24px",
  pill: "9999px",
} as const;

export const fontWeight = {
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
  black: 900,
} as const;

export const shadows = {
  soft: "0 1px 2px rgba(14, 14, 17, 0.04)",
  card: "0 18px 40px -24px rgba(14, 14, 17, 0.3)",
  lift: "0 16px 30px -14px rgba(14, 14, 17, 0.5)",
  ask: "0 18px 40px -24px rgba(14, 14, 17, 0.3)",
} as const;
