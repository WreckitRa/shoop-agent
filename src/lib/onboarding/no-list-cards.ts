/**
 * Illustrated "never wear" cards on the brands step.
 * Maps mock labels onto existing comfort / hardAvoid persist values.
 */

import {
  genderPresentationBucket,
  type SuggestionAudience,
} from "@/lib/onboarding/form-options";
import type { LovesVetoesContext } from "@/lib/onboarding/loves-vetoes-suggest";

export type NoListKind = "comfort" | "hard";

export type NoListCard = {
  id: string;
  label: string;
  kind: NoListKind;
  value: string;
  audience?: SuggestionAudience;
};

export const NO_LIST_CARDS: readonly NoListCard[] = [
  { id: "logos", label: "Loud logos", kind: "hard", value: "loud logos" },
  { id: "tight", label: "Anything tight", kind: "comfort", value: "no tight fits" },
  { id: "short", label: "Above the knee", kind: "comfort", value: "nothing short", audience: "feminine" },
  { id: "neon", label: "Neon", kind: "hard", value: "neon" },
  { id: "sheer", label: "See-through", kind: "comfort", value: "nothing sheer", audience: "feminine" },
  { id: "heels", label: "Heels", kind: "comfort", value: "no heels", audience: "feminine" },
  { id: "sleeve", label: "Sleeveless", kind: "comfort", value: "nothing sleeveless", audience: "feminine" },
  { id: "crop", label: "Crop tops", kind: "hard", value: "super cropped cuts", audience: "feminine" },
  { id: "ripped", label: "Distressed", kind: "hard", value: "distressed" },
  { id: "print", label: "Big prints", kind: "hard", value: "costume-y prints" },
  { id: "shine", label: "Shiny fabric", kind: "hard", value: "synthetic sheen" },
  { id: "fast", label: "Fast fashion", kind: "hard", value: "fast fashion" },
  { id: "chunky", label: "Chunky trainers", kind: "hard", value: "chunky sneakers" },
  { id: "lowrise", label: "Low rise", kind: "comfort", value: "no low rise" },
  { id: "fur", label: "Fur or leather", kind: "hard", value: "fur or leather" },
  { id: "skinny", label: "Skinny jeans", kind: "comfort", value: "no skinny jeans", audience: "masculine" },
  { id: "shorts", label: "Shorts", kind: "comfort", value: "no shorts", audience: "masculine" },
  { id: "sandals", label: "Sandals", kind: "comfort", value: "no sandals", audience: "masculine" },
];

const CARD_VALUES = new Set(NO_LIST_CARDS.map((c) => c.value.toLowerCase()));

function audienceOf(ctx: LovesVetoesContext): SuggestionAudience | "any" {
  const bucket = genderPresentationBucket(ctx.genderPresentation);
  if (bucket === "masculine") return "masculine";
  if (bucket === "feminine") return "feminine";
  return "any";
}

export function noListCardsFor(ctx: LovesVetoesContext): NoListCard[] {
  const audience = audienceOf(ctx);
  return NO_LIST_CARDS.filter((card) => {
    if (!card.audience) return true;
    if (audience === "any") return true;
    return card.audience === audience;
  });
}

export function isCardValue(value: string): boolean {
  return CARD_VALUES.has(value.trim().toLowerCase());
}

export function isNoListOn(
  card: NoListCard,
  comfort: string[],
  hardAvoids: string[],
): boolean {
  const hay = card.kind === "comfort" ? comfort : hardAvoids;
  const key = card.value.toLowerCase();
  return hay.some((v) => v.trim().toLowerCase() === key);
}

function toggle(list: string[], value: string): string[] {
  const key = value.toLowerCase();
  const has = list.some((v) => v.trim().toLowerCase() === key);
  if (has) return list.filter((v) => v.trim().toLowerCase() !== key);
  return [...list, value];
}

export function applyNoListTap(
  card: NoListCard,
  comfort: string[],
  hardAvoids: string[],
): { comfort: string[]; hardAvoids: string[] } {
  if (card.kind === "comfort") {
    return { comfort: toggle(comfort, card.value), hardAvoids };
  }
  return { comfort, hardAvoids: toggle(hardAvoids, card.value) };
}
