export type ShoppingFeelingId =
  | "curious"
  | "frugal"
  | "splurgy"
  | "decisive"
  | "picky";

export type ShoppingFeelingOption = {
  id: ShoppingFeelingId;
  emoji: string;
  label: string;
  hint: string;
  enabled: boolean;
};

export const SHOPPING_FEELING_OPTIONS: ShoppingFeelingOption[] = [
  {
    id: "curious",
    emoji: "✨",
    label: "Curious",
    hint: "exploring, open to anything",
    enabled: true,
  },
  {
    id: "frugal",
    emoji: "💸",
    label: "Frugal",
    hint: "tight budget, cheap that works",
    enabled: false,
  },
  {
    id: "splurgy",
    emoji: "🌟",
    label: "Splurgy",
    hint: "treat me, quality over price",
    enabled: false,
  },
  {
    id: "decisive",
    emoji: "🎯",
    label: "Decisive",
    hint: "one pick, cut the fluff",
    enabled: false,
  },
  {
    id: "picky",
    emoji: "🧐",
    label: "Picky",
    hint: "high bar, won't settle",
    enabled: false,
  },
];

export const DEFAULT_SHOPPING_FEELING: ShoppingFeelingId = "curious";
