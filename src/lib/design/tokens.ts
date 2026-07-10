/**
 * Design tokens — quiet luxury system inferred from Shoop home prototypes.
 * Warm cream page, near-black ink, brand red accent, generous radii.
 * Tailwind theme (`tailwind.config.ts`) imports from here; TSX inline styles import from here.
 */

export const colors = {
  brand: {
    /** Matches Shoop wordmark / icon red (`#E3100F`). */
    primary: "#E3100F",
    dark: "#B80D0C",
    tint: "#FDF1F0",
    borderLight: "#F8C4C3",
  },
  text: {
    primary: "#0C0C0C",
    secondary: "#5C5A56",
    muted: "#9A9790",
    soft: "#3D3B38",
    disabled: "#C8C5BE",
    onBrand: "#FFFFFF",
  },
  surface: {
    page: "#F9F7F5",
    default: "#FFFFFF",
    tint: "#F1EFEC",
    subtle: "#EBE8E4",
    muted: "#E4E0DB",
    elevated: "#FFFFFF",
    warm: "#F3F1EE",
    neutral: "#FAF9F7",
  },
  border: {
    default: "#E6E3DE",
    hairlineSoft: "#EFECE8",
    medium: "#D4D0C9",
    slate: "#E2DFD9",
  },
  success: {
    DEFAULT: "#0F7B5C",
    dark: "#0A5C45",
    deeper: "#084C39",
    tint: "#ECF8F3",
    bgSoft: "#F2FAF6",
  },
  error: {
    DEFAULT: "#E3100F",
    deep: "#B80D0C",
    bg: "#FDF1F0",
    border: "#F8C4C3",
  },
  warning: {
    DEFAULT: "#C4841D",
    dark: "#8A5A10",
    tint: "#FBF3E4",
    emphasis: "#9A6412",
  },
  info: {
    border: "#E6E3DE",
    bg: "#F3F1EE",
    bgHover: "#EBE8E4",
    accent: "#0C0C0C",
    text: "#3D3B38",
  },
} as const;

export const fontSize = {
  caption: 11,
  small: 12,
  body: 13,
  base: 14,
  emphasis: 15,
  h3: 20,
  h2: 22,
} as const;

export const fontWeight = {
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
  black: 900,
} as const;

export const radius = {
  base: 10,
  lg: 14,
  xl: 18,
  "2xl": 24,
} as const;

export const shadow = {
  brandHero: "0 8px 32px rgba(12, 12, 12, 0.06)",
  brandHover: "0 12px 40px rgba(12, 12, 12, 0.1)",
  soft: "0 2px 12px rgba(12, 12, 12, 0.04)",
  card: "0 1px 2px rgba(12, 12, 12, 0.03), 0 8px 24px rgba(12, 12, 12, 0.04)",
} as const;

export const brandAssets = {
  heroShopping: "/assets/shoop-hero-shopping.png?v=4",
} as const;

export const tailwindThemeColors = {
  brand: {
    DEFAULT: colors.brand.primary,
    dark: colors.brand.dark,
    tint: colors.brand.tint,
  },
  ink: {
    DEFAULT: colors.text.primary,
    soft: colors.text.soft,
    muted: colors.text.muted,
    secondary: colors.text.secondary,
  },
  page: colors.surface.page,
  warm: colors.surface.warm,
  surface: {
    DEFAULT: colors.surface.default,
    tint: colors.surface.tint,
    subtle: colors.surface.subtle,
    muted: colors.surface.muted,
    elevated: colors.surface.elevated,
    neutral: colors.surface.neutral,
  },
  hairline: {
    DEFAULT: colors.border.default,
    soft: colors.border.hairlineSoft,
  },
  success: {
    DEFAULT: colors.success.DEFAULT,
    dark: colors.success.dark,
    tint: colors.success.tint,
    bgSoft: colors.success.bgSoft,
  },
  warning: {
    DEFAULT: colors.warning.DEFAULT,
    dark: colors.warning.dark,
    tint: colors.warning.tint,
    emphasis: colors.warning.emphasis,
  },
  error: {
    DEFAULT: colors.error.DEFAULT,
    deep: colors.error.deep,
    bg: colors.error.bg,
    border: colors.error.border,
  },
  info: {
    border: colors.info.border,
    bg: colors.info.bg,
    bgHover: colors.info.bgHover,
    accent: colors.info.accent,
    text: colors.info.text,
  },
  line: {
    slate: colors.border.slate,
    medium: colors.border.medium,
  },
} as const;
