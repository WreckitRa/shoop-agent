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
  Parisian: /parisian|french|cafe|café|quiet.?luxury|airport|effortless|smart.?casual/i,
  Minimal: /minimal|clean|gallery|neutral|simple|modern|layered/i,
  Romantic: /romantic|blouse|garden|soft|feminine|sequin|party|body.?conscious|vintage/i,
  Street: /street|denim|sharp|urban|logo|chunky|grunge|utility/i,
  Classic: /classic|tailored|blazer|polished|classy|put.?together|preppy|workwear/i,
  Sporty: /athleisure|sport|athletic|knit|jeans/i,
  Boho: /boho|festival|linen|relaxed|resort|oversized|bohemian/i,
  Bold: /bold|neon|statement|unique|cool|edgy|print|evening|dressy/i,
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

function bumpArchetype(
  scores: Map<AxisKey, number>,
  archetype: string | undefined,
  weight: number,
): boolean {
  if (!archetype?.trim()) return false;
  const key = archetype.trim() as AxisKey;
  if (!(key in AXIS_KEYWORDS)) return false;
  bump(scores, key, weight);
  return true;
}

/**
 * Deterministic Shooping Cart mix from worn + aspirational picks and compliments.
 * Casting-matrix archetypes vote 1:1 onto axes (worn ×3, aspirational ×2).
 * Labels/tags remain a soft fallback when archetype is missing.
 */
export function computeStyleMix(input: {
  wornLabels?: string[];
  aspirationalLabels?: string[];
  /** Casting-matrix axes from worn picks (preferred over keyword scoring). */
  wornArchetypes?: string[];
  aspirationalArchetypes?: string[];
  compliments?: string[];
  tasteTags?: string[];
  /** Honest Corner — who they want to become (heading + soft axis votes). */
  styleBecome?: string | null;
  /** Honest Corner — what they dislike now (soft axis votes). */
  styleFriction?: string | null;
}): StyleMix {
  const scores = new Map<AxisKey, number>();

  const wornArch = input.wornArchetypes ?? [];
  const aspArch = input.aspirationalArchetypes ?? [];
  let archetypeVotes = 0;
  for (const a of wornArch) {
    if (bumpArchetype(scores, a, 3)) archetypeVotes += 1;
  }
  for (const a of aspArch) {
    if (bumpArchetype(scores, a, 2)) archetypeVotes += 1;
  }

  if (input.styleBecome?.trim()) scoreText(scores, input.styleBecome, 2);
  if (input.styleFriction?.trim()) scoreText(scores, input.styleFriction, 1);

  // Keyword fallback only when we lack clean archetype votes (legacy / partial).
  if (archetypeVotes === 0) {
    for (const label of input.wornLabels ?? []) {
      scoreText(scores, label, 3);
    }
    for (const label of input.aspirationalLabels ?? []) {
      scoreText(scores, label, 2);
    }
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
    (input.styleBecome?.trim()
      ? capitalizeHeading(input.styleBecome.trim())
      : null) ??
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
