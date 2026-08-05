import { z } from "zod";
import type { CurationPdpInsight } from "@/lib/ai-chat/types";

const bullet = (max: number) => z.string().trim().min(4).max(max);

export type { CurationPdpInsight };

/** PDP + sidebar fields every curated pick must include (tool-enforced). */
export const pickInsightSchema = z
  .object({
    retailer_check_note: bullet(100),
    fit_reasons: z.array(bullet(200)).min(3).max(3),
    checked_items: z.array(bullet(120)).min(3).max(5),
    pick_story: z.string().trim().min(40).max(520),
    change_mind: z.array(bullet(160)).min(2).max(4),
  })
  .strict();

export type PickInsightInput = z.infer<typeof pickInsightSchema>;

export function normalizePickInsight(
  raw: PickInsightInput | Partial<PickInsightInput> | null | undefined,
  fallbackReason: string,
): CurationPdpInsight {
  const reason = fallbackReason.trim() || "Matches what you asked for in this search.";
  const fit = sanitizeBullets(raw?.fit_reasons, 3, 3, [
    reason,
    "Aligns with your stated preferences from profile and search context.",
    "Strong match among the options returned in this catalog search.",
  ]);
  const checked = sanitizeBullets(raw?.checked_items, 3, 5, [
    "Price shown in this Shoop catalog result",
    "Variant options and availability signals",
    "Fit with your search query and stored preferences",
  ]);
  const change = sanitizeBullets(raw?.change_mind, 2, 4, [
    "If the price moves meaningfully above what you wanted to spend",
    "If you tell us your priorities changed (fit, brand, or timing)",
  ]);
  const story =
    raw?.pick_story?.trim().slice(0, 520) ||
    `I compared the options from your search and this one best matches what you asked for — ${reason}`;

  const retailer =
    raw?.retailer_check_note?.trim().slice(0, 100) ||
    "Compared options in this Shoop search · just now";

  return {
    retailerCheckNote: retailer,
    fitReasons: fit as [string, string, string],
    checkedItems: checked,
    pickStory: story,
    changeMindItems: change,
  };
}

function sanitizeBullets(
  raw: string[] | undefined,
  min: number,
  max: number,
  defaults: string[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of raw ?? []) {
    const t = line.trim();
    if (t.length < 4 || seen.has(t)) continue;
    seen.add(t);
    out.push(t.slice(0, 160));
    if (out.length >= max) break;
  }
  for (const d of defaults) {
    if (out.length >= min) break;
    if (!seen.has(d)) {
      seen.add(d);
      out.push(d);
    }
  }
  while (out.length < min) {
    out.push(defaults[out.length % defaults.length] ?? "Catalog metadata review");
  }
  return out.slice(0, max);
}

/** Append relative time from persisted `updatedAt` (ISO). */
export function formatRetailerCheckDisplay(
  note: string,
  updatedAtIso: string | null | undefined,
): string {
  const base = note.trim();
  if (!updatedAtIso) return base;
  const rel = formatRelativeMinutes(updatedAtIso);
  if (!rel) return base;
  if (/ago|just now|today/i.test(base)) return base;
  return `${base.replace(/\s*·\s*$/, "")} · ${rel}`;
}

function formatRelativeMinutes(iso: string): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const mins = Math.max(0, Math.floor((Date.now() - t) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export type VerificationFacts = {
  priceVerified: boolean;
  sizeExactMatch: boolean | null;
  colorGatePassed: boolean | null;
  genderGatePassed: boolean | null;
  candidateCount: number;
};

/** Only list checks that deterministic code actually performed. */
export function buildHonestCheckedItems(facts: VerificationFacts): string[] {
  const items: string[] = [];
  if (facts.priceVerified) {
    items.push("Price re-checked via live catalog lookup");
  }
  if (facts.sizeExactMatch === true) {
    items.push("Your size is in stock at checkout");
  }
  if (facts.colorGatePassed === true) {
    items.push("Color matched your stated requirement");
  }
  if (facts.genderGatePassed === true) {
    items.push("Gender scope matched your profile");
  }
  const n = Math.max(1, facts.candidateCount);
  items.push(`Compared ${n} candidate${n === 1 ? "" : "s"} in this search`);
  return items.slice(0, 5);
}

type SelfCheckLike = {
  color: { pass: boolean; note: string; required: string };
  gender: { pass: boolean; note: string; required: string };
  sizeInStock: { pass: boolean; note: string; required: string };
};

/** Checked items from explicit tier-1 self-verification (only passed dimensions). */
export function buildCheckedItemsFromSelfCheck(
  selfCheck: SelfCheckLike,
  facts: VerificationFacts,
): string[] {
  const items: string[] = [];
  if (
    selfCheck.color.pass &&
    selfCheck.color.required !== "none" &&
    facts.colorGatePassed !== false
  ) {
    items.push(selfCheck.color.note.slice(0, 120));
  }
  if (
    selfCheck.gender.pass &&
    selfCheck.gender.required !== "none" &&
    facts.genderGatePassed !== false
  ) {
    items.push(selfCheck.gender.note.slice(0, 120));
  }
  if (
    selfCheck.sizeInStock.pass &&
    selfCheck.sizeInStock.required !== "none" &&
    facts.sizeExactMatch === true
  ) {
    items.push(selfCheck.sizeInStock.note.slice(0, 120));
  }
  if (facts.priceVerified) {
    items.push("Price re-checked via live catalog lookup");
  }
  const n = Math.max(1, facts.candidateCount);
  items.push(`Compared ${n} candidate${n === 1 ? "" : "s"} in this search`);
  return items.slice(0, 5);
}

export function buildHeuristicInsight(
  card: { title: string },
  candidateCount: number,
  slot: "shoop_pick" | "best_value" | "most_popular" | "gallery",
  reason: string,
  facts?: VerificationFacts,
  selfCheck?: SelfCheckLike,
): CurationPdpInsight {
  const n = Math.max(1, candidateCount);
  const baseFacts = facts ?? {
    priceVerified: false,
    sizeExactMatch: null,
    colorGatePassed: null,
    genderGatePassed: null,
    candidateCount: n,
  };
  baseFacts.candidateCount = n;
  const checked = selfCheck
    ? buildCheckedItemsFromSelfCheck(selfCheck, baseFacts)
    : facts
      ? buildHonestCheckedItems(baseFacts)
      : [`Compared ${n} candidate${n === 1 ? "" : "s"} in this search`];
  const slotLabel = slot.replace(/_/g, " ");
  const reasonLower =
    reason.length > 0 && /^[a-z]/.test(reason) ? reason : reason.toLowerCase();
  return normalizePickInsight(
    {
      retailer_check_note: `Compared ${n} option${n === 1 ? "" : "s"} in this Shoop search · just now`,
      fit_reasons: [
        reason,
        slot === "best_value"
          ? "Among verified options, price looks competitive for this slot."
          : `Selected for the ${slotLabel} slot after tier judgment.`,
        slot === "shoop_pick"
          ? "Top tier placement from the curated rack for this search."
          : "Worth comparing against the featured picks before you decide.",
      ],
      checked_items: checked,
      pick_story: `I looked at ${n} product${n === 1 ? "" : "s"} from your search. ${card.title} stood out as the ${slotLabel} because ${reasonLower}`,
      change_mind: [
        "If the price jumps well above what you wanted to spend",
        "If your required size or color is not actually available at checkout",
        ...(slot === "shoop_pick"
          ? ["If you tell us you want a firmer/different feel than this style"]
          : []),
      ].slice(0, 4) as [string, string],
    },
    reason,
  );
}
