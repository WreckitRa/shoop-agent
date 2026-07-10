/** Category axes for onboarding taste swipe (products loaded from Shopify catalog). */

export type TasteCardCategory =
  | "outfit"
  | "furniture"
  | "tech"
  | "lifestyle"
  | "personality";

export const TASTE_CATEGORY_LABELS: Record<TasteCardCategory, string> = {
  outfit: "Outfits",
  furniture: "Home & furniture",
  tech: "Tech & gadgets",
  lifestyle: "Lifestyle",
  personality: "Overall vibe",
};
