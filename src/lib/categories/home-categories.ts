import type { LucideIcon } from "lucide-react";
import {
  Cpu,
  Dumbbell,
  Gift,
  HeartPulse,
  Home,
  Palette,
  Shirt,
  TreePine,
  Puzzle,
} from "lucide-react";
import { SHOPIFY_SEARCH_TOOL_NAME } from "@/lib/ai-chat/shopify-search-tool";

export type HomeCategory = {
  name: string;
  imageUrl: string;
  fallbackBg: string;
  query: string;
  icon: LucideIcon;
};

export const HOME_CATEGORIES: readonly HomeCategory[] = [
  {
    name: "Beauty",
    imageUrl: "/images/categories/beauty.jpg",
    fallbackBg: "rgb(242, 232, 228)",
    query:
      "clean beauty essentials — everyday skincare and makeup that works for sensitive skin",
    icon: Palette,
  },
  {
    name: "Fashion",
    imageUrl: "/images/categories/fashion.jpg",
    fallbackBg: "rgb(245, 241, 235)",
    query: "a structured navy blazer I can wear to meetings and dinner",
    icon: Shirt,
  },
  {
    name: "Gifts",
    imageUrl: "/images/categories/gifts.jpg",
    fallbackBg: "rgb(243, 230, 228)",
    query:
      "thoughtful gifts under $75 for someone who loves cozy, personal surprises",
    icon: Gift,
  },
  {
    name: "Health & Wellness",
    imageUrl: "/images/categories/wellness.jpg",
    fallbackBg: "rgb(228, 236, 234)",
    query:
      "wellness gear for daily recovery — yoga, sleep, and mindful self-care",
    icon: HeartPulse,
  },
  {
    name: "Homes",
    imageUrl: "/images/categories/home.jpg",
    fallbackBg: "rgb(238, 232, 220)",
    query: "modern home decor that feels warm and lived-in, not sterile",
    icon: Home,
  },
  {
    name: "Outdoors",
    imageUrl: "/images/categories/outdoor.jpg",
    fallbackBg: "rgb(228, 236, 226)",
    query: "durable outdoor gear for weekend hikes and camping trips",
    icon: TreePine,
  },
  {
    name: "Sporting Goods",
    imageUrl: "/images/categories/sporting.jpg",
    fallbackBg: "rgb(229, 235, 227)",
    query: "entry-level running and gym equipment for home workouts",
    icon: Dumbbell,
  },
  {
    name: "Tech & Electronics",
    imageUrl: "/images/categories/tech.jpg",
    fallbackBg: "rgb(232, 234, 237)",
    query:
      "useful everyday tech — wireless earbuds, chargers, and smart home basics",
    icon: Cpu,
  },
  {
    name: "Toys & Hobbies",
    imageUrl: "/images/categories/toys.jpg",
    fallbackBg: "rgb(245, 239, 219)",
    query: "creative toys and hobby kits for curious kids and adults",
    icon: Puzzle,
  },
] as const;

const byName = new Map(HOME_CATEGORIES.map((c) => [c.name, c]));

export function resolveHomeCategories(names: string[]): HomeCategory[] {
  const out: HomeCategory[] = [];
  for (const name of names) {
    const cat = byName.get(name);
    if (cat) out.push(cat);
  }
  return out;
}

export function homeCategorySearchAddendum(names: string[]): string {
  const cats = resolveHomeCategories(names);
  if (!cats.length) return "";

  const lines = cats
    .map((c) => `- **${c.name}**: ${c.query}`)
    .join("\n");

  return `## Active category focus
The user selected these shopping categories from the home picker. When you call \`${SHOPIFY_SEARCH_TOOL_NAME}\`, weave the relevant seed intents into your \`query\` (style, use case, sizing, budget constraints):
${lines}`;
}

export function homeCategoryMemoryHint(names: string[]): string {
  const cats = resolveHomeCategories(names);
  if (!cats.length) return "";
  return cats.map((c) => `${c.name}: ${c.query}`).join("\n");
}
