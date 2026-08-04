import type { Config } from "tailwindcss";

import { tailwindThemeColors } from "./src/lib/design/tokens";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: tailwindThemeColors,
      fontFamily: {
        sans: ["var(--font-dm-sans)", "system-ui", "sans-serif"],
        serif: ["var(--font-cormorant)", "Georgia", "serif"],
        display: ["var(--font-archivo)", "var(--font-dm-sans)", "system-ui", "sans-serif"],
        whisper: ["var(--font-fraunces)", "Georgia", "serif"],
        mono: ["var(--font-jetbrains-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        "display-xl": [
          "56px",
          { lineHeight: "1.02", letterSpacing: "-0.02em", fontWeight: "600" },
        ],
        "display-lg": [
          "42px",
          { lineHeight: "1.06", letterSpacing: "-0.02em", fontWeight: "600" },
        ],
        "display-md": [
          "32px",
          { lineHeight: "1.1", letterSpacing: "-0.015em", fontWeight: "600" },
        ],
        "display-sm": [
          "24px",
          { lineHeight: "1.2", letterSpacing: "-0.01em", fontWeight: "600" },
        ],
        "body-lg": ["17px", { lineHeight: "1.55" }],
        body: ["15px", { lineHeight: "1.6" }],
        "body-sm": ["13px", { lineHeight: "1.55" }],
        caption: ["11px", { lineHeight: "1.4", letterSpacing: "0.06em" }],
      },
      borderRadius: {
        DEFAULT: "12px",
        sm: "8px",
        md: "12px",
        lg: "16px",
        xl: "20px",
        "2xl": "24px",
        "3xl": "28px",
        "4xl": "36px",
      },
      maxWidth: {
        "page-narrow": "720px",
        page: "960px",
        "page-wide": "1100px",
      },
      transitionTimingFunction: {
        ios: "cubic-bezier(0.4, 0, 0.2, 1)",
      },
      boxShadow: {
        soft: "0 1px 2px rgba(14, 14, 17, 0.04)",
        card: "0 18px 40px -24px rgba(14, 14, 17, 0.3)",
        lift: "0 16px 30px -14px rgba(14, 14, 17, 0.5)",
        ask: "0 18px 40px -24px rgba(14, 14, 17, 0.3)",
      },
    },
  },
} satisfies Config;
