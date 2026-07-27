import type { styleMixSchema } from "@/lib/ai-chat/profile/validators";
import type { z } from "zod";

export type StyleMix = z.infer<typeof styleMixSchema>;

type AxisKey =
  | "Parisian"
  | "Minimal"
  | "Romantic"
  | "Street"
  | "Classic"
  | "Sporty"
  | "Boho"
  | "Bold";

const AXIS_KEYWORDS: Record<AxisKey, RegExp> = {
  Parisian: /parisian|french|cafe|café|quiet.?luxury|airport|effortless/i,
  Minimal: /minimal|clean|gallery|neutral|simple|modern/i,
  Romantic: /romantic|blouse|garden|soft|feminine|sequin|party/i,
  Street: /street|denim|sharp|urban|logo|chunky/i,
  Classic: /classic|tailored|blazer|polished|classy|put.?together/i,
  Sporty: /athleisure|sport|athletic|knit|jeans/i,
  Boho: /boho|festival|linen|relaxed/i,
  Bold: /bold|neon|statement|unique|cool/i,
};

const COMPLIMENT_TO_HEADING: Record<string, string> = {
  Effortless: "Effortless",
  Polished: "Polished",
  Bold: "Bold",
  Expensive: "Expensive",
  Unique: "Unique",
  Classy: "Classy",
  "Put-together": "Put-together",
  Cool: "Cool",
};

function bump(scores: Map<AxisKey, number>, key: AxisKey, amount: number) {
  scores.set(key, (scores.get(key) ?? 0) + amount);
}

function scoreText(scores: Map<AxisKey, number>, text: string, weight: number) {
  for (const [axis, re] of Object.entries(AXIS_KEYWORDS) as Array<[AxisKey, RegExp]>) {
    if (re.test(text)) bump(scores, axis, weight);
  }
}

/**
 * Deterministic Shooping Cart mix from worn + aspirational labels and compliments.
 * Worn picks weigh more (who you are); aspirational + compliments steer headingToward.
 */
export function computeStyleMix(input: {
  wornLabels?: string[];
  aspirationalLabels?: string[];
  compliments?: string[];
  tasteTags?: string[];
}): StyleMix {
  const scores = new Map<AxisKey, number>();

  for (const label of input.wornLabels ?? []) {
    scoreText(scores, label, 3);
  }
  for (const label of input.aspirationalLabels ?? []) {
    scoreText(scores, label, 2);
  }
  for (const tag of input.tasteTags ?? []) {
    scoreText(scores, tag, 1);
  }
  for (const c of input.compliments ?? []) {
    scoreText(scores, c, 1.5);
  }

  // Sensible defaults when nothing matched.
  if (scores.size === 0) {
    bump(scores, "Minimal", 3);
    bump(scores, "Classic", 2);
    bump(scores, "Parisian", 1);
  }

  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const total = sorted.reduce((sum, [, v]) => sum + v, 0) || 1;
  let remaining = 100;
  const axes = sorted.map(([label, value], index) => {
    const percent =
      index === sorted.length - 1
        ? remaining
        : Math.max(1, Math.round((value / total) * 100));
    if (index < sorted.length - 1) remaining -= percent;
    return { label, percent };
  });

  const compliments = (input.compliments ?? [])
    .map((c) => c.trim())
    .filter(Boolean);
  const headingToward =
    compliments
      .map((c) => COMPLIMENT_TO_HEADING[c] ?? c)
      .find(Boolean) ??
    (input.aspirationalLabels?.[0]
      ? capitalizeHeading(input.aspirationalLabels[0])
      : null);

  return {
    axes,
    headingToward: headingToward || null,
    headingPercent: headingToward ? 25 : null,
  };
}

function capitalizeHeading(raw: string): string {
  const cleaned = raw.replace(/[-_]+/g, " ").trim();
  if (!cleaned) return "Polished";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1, 40);
}

export function formatStyleMixNarration(
  mix: StyleMix,
  preferredName?: string | null,
): { title: string; body: string; locked: string } {
  const name = preferredName?.trim() || "friend";
  const axisLine = mix.axes
    .map((a) => `${a.percent}% ${a.label}`)
    .join(", ");
  const heading =
    mix.headingToward && mix.headingPercent
      ? ` and you're heading somewhere ${mix.headingPercent}% more ${mix.headingToward}`
      : "";
  return {
    title: `Meet your Shooping Cart, ${name}.`,
    body: `Today you're ${axisLine}${heading}. Noted.\n\nI'll dress who you are, nudge you toward who you're becoming, and tell you the truth the whole way.`,
    locked: "The better we know you, the better you look.",
  };
}
