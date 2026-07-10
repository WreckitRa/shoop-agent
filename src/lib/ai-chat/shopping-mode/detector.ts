import type { ShoppingMode } from "./types";
import { detectContextExpertise } from "@/lib/ai-chat/shopping-mode/context-expertise";

/**
 * Deterministic, zero-LLM shopping-mode detector.
 *
 * Strategy: score each of the four modes from cheap textual signals
 * (specific products, money phrases, gift/discovery phrases, named
 * occasions). The strongest signal wins; ties bias toward `hybrid` —
 * the explicit "default fallback" called out in the product spec.
 *
 * This runs synchronously on the server before the prompt is built, so
 * latency must stay negligible. No tokenizer, no model call, no network.
 */

type Scored = {
  mode: ShoppingMode;
  score: number;
  reasons: string[];
};

const PRICE_PATTERNS: RegExp[] = [
  /\bunder\s*\$?\s*\d/iu,
  /\bbelow\s*\$?\s*\d/iu,
  /\bless\s+than\s*\$?\s*\d/iu,
  /\babout\s*\$?\s*\d/iu,
  /\baround\s*\$?\s*\d/iu,
  /\bmax(?:imum)?\s*\$?\s*\d/iu,
  /\bbudget\s*(?:of|is)?\s*\$?\s*\d/iu,
  /\$\s*\d{1,5}/u,
  /\b\d{2,5}\s*(?:eur|usd|gbp|cad)\b/iu,
  /\b\d{2,5}\s*€\b/u,
  /\b€\s*\d{2,5}\b/u,
];

/** "size 10", "EU 42", "US 9", "L", "XL", "32x32" */
const SIZE_PATTERNS: RegExp[] = [
  /\bsize\s*(?:us|uk|eu)?\s*\d{1,3}(?:\.\d)?\b/iu,
  /\b(?:eu|us|uk)\s*\d{1,3}(?:\.\d)?\b/iu,
  /\b\d{2}x\d{2}\b/u,
  /\b(?:xxs|xs|small|medium|large|xl|xxl|xxxl)\b/iu,
];

/** Things like "iPhone 15 Pro Max", "AirPods Pro Max", "Sony WH-1000XM5". */
const SPECIFIC_PRODUCT_PATTERNS: RegExp[] = [
  /\b[a-z][a-z0-9-]*\s+(?:pro|max|ultra|plus|mini|air|x)\s*(?:max|plus|s)?\b/iu,
  /\b[a-z]+-\s*\d+\s*[a-z0-9]+\b/iu,
  /\b[a-z]{2,}\s+\d{2,4}[a-z]{0,4}\b/iu,
];

/**
 * Brand mentions are a *judge* signal when paired with a concrete spec or
 * price. A brand alone (e.g. "I love Patagonia") is too soft.
 */
const KNOWN_BRAND_TOKENS = new Set([
  "airpods",
  "iphone",
  "macbook",
  "ipad",
  "samsung",
  "galaxy",
  "pixel",
  "sony",
  "bose",
  "kindle",
  "playstation",
  "ps5",
  "xbox",
  "nintendo",
  "switch",
  "nike",
  "adidas",
  "new balance",
  "asics",
  "hoka",
  "salomon",
  "patagonia",
  "arc'teryx",
  "lululemon",
  "uniqlo",
  "levi's",
  "carhartt",
  "dyson",
  "vitamix",
  "kitchenaid",
  "le creuset",
  "lego",
  "rolex",
  "garmin",
  "fitbit",
  "apple watch",
  "rayban",
  "ray-ban",
  "oakley",
  "tesla",
]);

const COMPARISON_PHRASES: RegExp[] = [
  /\bwhich\s+is\s+better\b/iu,
  /\b(?:vs\.?|versus)\b/iu,
  /\bshould\s+i\s+(?:buy|get|pick)\b/iu,
];

const GIFT_PHRASES: RegExp[] = [
  /\bgift\b/iu,
  /\bpresent\b/iu,
  /\bfor\s+(?:my|a)\s+(?:wife|husband|mom|mum|mother|dad|father|girlfriend|boyfriend|partner|friend|sister|brother|son|daughter|kid|kids|niece|nephew|coworker|boss|teacher)\b/iu,
  /\bbirthday\b/iu,
  /\banniversary\b/iu,
  /\bvalentine'?s?\b/iu,
  /\bchristmas\b/iu,
];

const DISCOVERY_PHRASES: RegExp[] = [
  /\b(?:i\s*don'?t|i\s*dont|not\s*sure|no\s*idea)\b/iu,
  /\bhelp\s+me\s+(?:choose|pick|decide|find)\b/iu,
  /\bsurprise\s+me\b/iu,
  /\bany\s+(?:ideas?|suggestions?|recs?|recommendations?)\b/iu,
  /\bshow\s+me\s+(?:some|options?)\b/iu,
  /\bbrowse\b/iu,
  /\bwhat\s+(?:should|would|could)\s+i\b/iu,
  /\binspire\s+me\b/iu,
  /\binspiration\b/iu,
];

const OCCASION_PHRASES: RegExp[] = [
  /\bburning\s*man\b/iu,
  /\bcoachella\b/iu,
  /\btomorrowland\b/iu,
  /\bski\s+trip\b/iu,
  /\bsnow(?:board)?ing\s+trip\b/iu,
  /\bwedding\s+(?:guest|attend|invite)\b/iu,
  /\bbachelor(?:ette)?\s+party\b/iu,
  /\bhoneymoon\b/iu,
  /\bfirst\s+date\b/iu,
  /\bjob\s+interview\b/iu,
  /\b(?:going|moving)\s+to\s+[a-z]{3,}/iu,
  /\b(?:road|camping|hiking|surf|safari)\s+trip\b/iu,
  /\bfestival\b/iu,
  /\bgalas?\b/iu,
  /\bblack\s*tie\b/iu,
  /\bcocktail\s+(?:party|attire|event)\b/iu,
  /\bnew\s+(?:job|apartment|home|baby)\b/iu,
];

function countMatches(text: string, patterns: RegExp[]): number {
  let n = 0;
  for (const p of patterns) {
    if (p.test(text)) n++;
  }
  return n;
}

export function textMentionsKnownBrand(text: string): boolean {
  const lower = text.toLowerCase();
  for (const b of KNOWN_BRAND_TOKENS) {
    if (lower.includes(b)) return true;
  }
  return false;
}

function looksLikeNumberedSpec(text: string): boolean {
  return /\b\d{1,4}\s?(?:gb|tb|mhz|ghz|w|wh|mah|inch(?:es)?|in|mm|cm|°c|°f|hz)\b/iu.test(
    text,
  );
}

function ruleScore(text: string): Scored[] {
  const reasonsJudge: string[] = [];
  const reasonsCopilot: string[] = [];
  const reasonsDirectional: string[] = [];

  let judge = 0;
  let copilot = 0;
  let directional = 0;

  if (countMatches(text, PRICE_PATTERNS) > 0) {
    judge += 2;
    reasonsJudge.push("explicit price / budget");
  }
  if (countMatches(text, SIZE_PATTERNS) > 0) {
    judge += 1.5;
    reasonsJudge.push("explicit size");
  }
  if (looksLikeNumberedSpec(text)) {
    judge += 1.5;
    reasonsJudge.push("technical spec mentioned");
  }
  if (countMatches(text, COMPARISON_PHRASES) > 0) {
    judge += 1.5;
    reasonsJudge.push("comparison framing");
  }
  if (textMentionsKnownBrand(text)) {
    judge += 1;
    reasonsJudge.push("specific brand mentioned");
  }
  if (countMatches(text, SPECIFIC_PRODUCT_PATTERNS) > 0) {
    judge += 1;
    reasonsJudge.push("specific product name");
  }

  const giftHits = countMatches(text, GIFT_PHRASES);
  if (giftHits > 0) {
    copilot += 2;
    reasonsCopilot.push("gift / recipient framing");
  }
  const discoveryHits = countMatches(text, DISCOVERY_PHRASES);
  if (discoveryHits > 0) {
    copilot += 2 + Math.min(discoveryHits - 1, 2) * 0.5;
    reasonsCopilot.push("uncertain / exploratory wording");
  }

  const occasionHits = countMatches(text, OCCASION_PHRASES);
  if (occasionHits > 0) {
    directional += 3;
    reasonsDirectional.push("named context / occasion");
  }
  // A *contextual destination* (moving / trip to a city) without a product
  // pulls hard toward directional.
  if (/\b(?:moving|relocating|travel(?:ing|ling)?)\b/iu.test(text)) {
    directional += 1.5;
    reasonsDirectional.push("travel / relocation");
  }

  // Vague single-word category queries (e.g. "shoes", "headphones") with no
  // budget / brand / size lean copilot rather than judge.
  if (/^[\s\w]{1,30}\??$/u.test(text) && text.split(/\s+/u).length <= 4) {
    if (judge === 0 && directional === 0) {
      copilot += 1;
      reasonsCopilot.push("short, broad ask");
    }
  }

  return [
    { mode: "judge", score: judge, reasons: reasonsJudge },
    { mode: "copilot", score: copilot, reasons: reasonsCopilot },
    { mode: "directional", score: directional, reasons: reasonsDirectional },
    { mode: "hybrid", score: 0, reasons: [] },
  ];
}

export type DetectionInput = {
  query: string;
  /**
   * Optional previously-resolved mode in the same conversation. Used as a
   * soft tiebreaker so a thread that opened in `copilot` doesn't bounce to
   * `judge` mid-conversation on a one-word follow-up like "yes".
   */
  previousMode?: ShoppingMode | null;
};

export type DetectionResult = {
  mode: ShoppingMode;
  reason: string;
  /** Detected context expertise tag, if any (e.g. "burning_man"). */
  contextTag: string | null;
};

export function detectShoppingMode(input: DetectionInput): DetectionResult {
  const text = (input.query ?? "").trim();
  if (!text) {
    return {
      mode: input.previousMode ?? "hybrid",
      reason: "empty query",
      contextTag: null,
    };
  }

  const scored = ruleScore(text);
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  const second = scored[1];

  // Detect named context for the expertise injection regardless of mode —
  // even hybrid responses get smarter when we know it's "wedding guest".
  const ctx = detectContextExpertise(text);

  // Hard rule: a strong directional signal always wins. Hybrid never beats
  // an actually-named occasion.
  const directional = scored.find((s) => s.mode === "directional");
  if (directional && directional.score >= 3) {
    return {
      mode: "directional",
      reason: directional.reasons[0] ?? "context query",
      contextTag: ctx?.tag ?? null,
    };
  }

  // Mixed signal: judge AND copilot both score. That's literally "hybrid"
  // in the spec — concrete enough to pick a lead, soft enough to need
  // alternatives.
  const judgeS = scored.find((s) => s.mode === "judge")?.score ?? 0;
  const copilotS = scored.find((s) => s.mode === "copilot")?.score ?? 0;
  if (judgeS >= 1.5 && copilotS >= 1.5) {
    return {
      mode: "hybrid",
      reason: "mixed objective + subjective signals",
      contextTag: ctx?.tag ?? null,
    };
  }

  // No signal at all → previous mode if we have one, else hybrid.
  if (top.score === 0) {
    return {
      mode: input.previousMode ?? "hybrid",
      reason: input.previousMode
        ? "continuing prior mode"
        : "no strong signal — default to hybrid",
      contextTag: ctx?.tag ?? null,
    };
  }

  // Clear winner (≥ +1.0 over runner-up).
  if (top.score - (second?.score ?? 0) >= 1) {
    return {
      mode: top.mode,
      reason: top.reasons[0] ?? "best matching signal",
      contextTag: ctx?.tag ?? null,
    };
  }

  // Otherwise hybrid (safer; lets the model show range).
  return {
    mode: "hybrid",
    reason: "ambiguous — default to hybrid",
    contextTag: ctx?.tag ?? null,
  };
}
