/**
 * PROFILES v2 helpers — structured context/tone/aspires lines and
 * occasion-aware signal ranking for the fashion router.
 */
import {
  BUDGET_OPTIONS,
  CLIMATE_OPTIONS,
  DRESSING_FOR_OPTIONS,
  HONESTY_OPTIONS,
  KIDS_OPTIONS,
  STYLE_ERAS,
  WEEK_IS_OPTIONS,
  WORLD_OPTIONS,
} from "@/lib/onboarding/form-options";
import type {
  FashionFactBodyNoteValue,
  FashionFactRow,
  RequestEventAttributes,
  RequestEventRow,
  StyleSignalRow,
} from "../types";
import { filterSignalsByEffectiveConfidence } from "../signal-confidence";
import { signalCanonicalKey } from "../normalize/signal-canonical";
import { garmentSlotFamilyKey } from "./garment-family";

const OCCASION_FAMILIES: Array<{
  family: string;
  keywords: RegExp;
  signalContexts: string[];
}> = [
  {
    family: "work",
    keywords: /\b(work|office|meeting|professional|career|commute)\b/i,
    signalContexts: ["work", "office", "professional", "elevated"],
  },
  {
    family: "event",
    keywords: /\b(wedding|party|gala|formal|date night|event|ceremony)\b/i,
    signalContexts: ["event", "elevated", "formal", "wedding", "party"],
  },
  {
    family: "gym",
    keywords: /\b(gym|workout|training|run|sport|athletic)\b/i,
    signalContexts: ["gym", "sport", "athletic", "training"],
  },
  {
    family: "weekend",
    keywords: /\b(weekend|casual|brunch|errands|everyday)\b/i,
    signalContexts: ["weekend", "casual", "everyday", "general"],
  },
  {
    family: "travel",
    keywords: /\b(travel|trip|flight|vacation|holiday)\b/i,
    signalContexts: ["travel", "vacation", "elevated"],
  },
  {
    family: "campus",
    keywords: /\b(campus|school|uni|college|class)\b/i,
    signalContexts: ["campus", "casual", "general"],
  },
];

export const KNOWN_SIGNAL_CONTEXTS: ReadonlySet<string> = new Set([
  "general",
  ...OCCASION_FAMILIES.flatMap((f) => [f.family, ...f.signalContexts]),
]);

export function inferOccasionFamilyHint(text: string | undefined): string | null {
  if (!text?.trim()) return null;
  for (const row of OCCASION_FAMILIES) {
    if (row.keywords.test(text)) return row.family;
  }
  return null;
}

function optionLabel(
  options: readonly { value: string; label: string }[],
  raw: string | undefined,
): string | null {
  if (!raw?.trim()) return null;
  return options.find((o) => o.value === raw)?.label.toLowerCase() ?? null;
}

function lifestyleLabel(tag: string): string {
  const hit = WORLD_OPTIONS.find((o) => o.value === tag);
  if (hit) {
    return hit.label
      .replace(/^Deep in my career$/i, "deep in career")
      .replace(/^First-job era$/i, "first-job")
      .replace(/^Running the show$/i, "running the show")
      .replace(/^Kids in the mix$/i, "kids in the mix")
      .replace(/^My time is mine again$/i, "time is mine")
      .replace(/^Campus life$/i, "campus life")
      .toLowerCase();
  }
  return tag.replace(/_/g, " ");
}

function valuePhilosophyLabel(raw: string): string | null {
  const parts = raw
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  if (!parts.length) return null;
  const labels: string[] = [];
  for (const p of parts) {
    const opt = BUDGET_OPTIONS.find((o) => o.value === p);
    if (opt) {
      if (p === "luxury") labels.push("quiet-luxury spender");
      else if (p === "premium") labels.push("quality-first spender");
      else if (p === "deal_hunter") labels.push("deal-hunter");
      else if (p === "best_value") labels.push("value-conscious spender");
      else if (p === "design_first") labels.push("design-led spender");
      else labels.push(opt.label.toLowerCase());
    } else {
      labels.push(p.replace(/_/g, " "));
    }
  }
  return labels[0] ?? null;
}

function styleEraShort(raw: string): string | null {
  const first = raw.split(",")[0]?.trim();
  if (!first) return null;
  const era = STYLE_ERAS.find((e) => e.value === first);
  if (!era) return first.replace(/_/g, " ");
  // "30s · Prime era" → "30s" + era note "prime"
  const m = era.label.match(/^([^\s·]+)\s*·\s*(.+)$/);
  if (m) {
    const age = m[1]!;
    const vibe = m[2]!.replace(/\s*era$/i, "").trim().toLowerCase();
    return vibe ? `${age}` : age;
  }
  return era.label;
}

function eraNote(raw: string): string | null {
  const first = raw.split(",")[0]?.trim();
  if (!first) return null;
  const era = STYLE_ERAS.find((e) => e.value === first);
  if (!era) return null;
  const m = era.label.match(/·\s*(.+)$/);
  if (!m) return null;
  return m[1]!.replace(/\s*era$/i, "").trim().toLowerCase();
}

export function honestyToneLine(
  honesty: string | null | undefined,
): string | null {
  if (!honesty?.trim()) return null;
  const v = honesty.trim().toLowerCase();
  if (v === "gentle" || v === "straight") {
    return `tone: honesty balanced ("tell me straight")`;
  }
  if (v === "no_mercy") return `tone: honesty high ("full stylist mode")`;
  const opt = HONESTY_OPTIONS.find((o) => o.value === v);
  return opt ? `tone: honesty ${opt.label.toLowerCase()}` : `tone: honesty ${v}`;
}

export function mapHonestyToVoice(
  honesty: string | null | undefined,
): "gentle" | "balanced" | "blunt" | undefined {
  const v = honesty?.trim().toLowerCase();
  if (v === "gentle" || v === "straight") return "balanced";
  if (v === "no_mercy") return "blunt";
  return undefined;
}

export type OnboardingMetaFromBodyNote = {
  age_range?: string;
  style_era?: string;
  lifestyle_tags?: string[];
  value_philosophy?: string;
  honesty_preference?: string;
  compliment_preferences?: string[];
  week_is?: string;
  dressing_for?: string;
  kids?: string;
  climate?: string;
};

export function parseOnboardingMetaFromFacts(
  facts: FashionFactRow[],
): OnboardingMetaFromBodyNote | null {
  const row = facts.find(
    (f) =>
      f.fact_type === "body_note" &&
      f.status === "active" &&
      (f.garment_type === "onboarding-meta" ||
        f.garment_type?.includes("onboarding")),
  );
  if (!row) return null;
  const value = row.value as FashionFactBodyNoteValue;
  return {
    age_range:
      typeof value.age_range === "string" ? value.age_range : undefined,
    style_era:
      typeof value.style_era === "string" ? value.style_era : undefined,
    lifestyle_tags: Array.isArray(value.lifestyle_tags)
      ? (value.lifestyle_tags as string[])
      : undefined,
    value_philosophy:
      typeof value.value_philosophy === "string"
        ? value.value_philosophy
        : undefined,
    honesty_preference:
      typeof value.honesty_preference === "string"
        ? value.honesty_preference
        : undefined,
    compliment_preferences: Array.isArray(value.compliment_preferences)
      ? (value.compliment_preferences as string[])
      : undefined,
    week_is: typeof value.week_is === "string" ? value.week_is : undefined,
    dressing_for:
      typeof value.dressing_for === "string" ? value.dressing_for : undefined,
    kids: typeof value.kids === "string" ? value.kids : undefined,
    climate: typeof value.climate === "string" ? value.climate : undefined,
  };
}

/** One-line `context:` from onboarding meta. Omit if nothing to say. */
export function composeContextLine(meta: OnboardingMetaFromBodyNote): string | null {
  const parts: string[] = [];

  const age = meta.age_range?.trim();
  if (age === "13-17") parts.push("teen");
  else if (age) {
    // Prefer era shorthand when present
    const eraShort = meta.style_era ? styleEraShort(meta.style_era) : null;
    if (eraShort && /^\d/.test(eraShort)) parts.push(eraShort);
    else if (age === "25-34") parts.push("30s");
    else if (age === "35-44") parts.push("40s");
    else if (age === "55-64") parts.push("50s–60s");
    else if (age === "65+") parts.push("65+");
    else if (age === "18-24") parts.push("early 20s");
    else parts.push(age);
  } else if (meta.style_era) {
    const eraShort = styleEraShort(meta.style_era);
    if (eraShort) parts.push(eraShort);
  }

  for (const tag of meta.lifestyle_tags ?? []) {
    parts.push(lifestyleLabel(tag));
  }

  const week = optionLabel(WEEK_IS_OPTIONS, meta.week_is);
  if (week && !parts.some((p) => p.includes(week))) parts.push(week);
  const dating = optionLabel(DRESSING_FOR_OPTIONS, meta.dressing_for);
  if (dating) parts.push(dating);
  const kids = optionLabel(KIDS_OPTIONS, meta.kids);
  if (kids && kids !== "no kids") parts.push(kids);
  const climate = optionLabel(CLIMATE_OPTIONS, meta.climate);
  if (climate) parts.push(climate);

  if (meta.value_philosophy) {
    const vp = valuePhilosophyLabel(meta.value_philosophy);
    if (vp) parts.push(vp);
  }

  if (meta.style_era) {
    const note = eraNote(meta.style_era);
    if (note && !parts.some((p) => p.includes(note))) {
      parts.push(`era: ${note}`);
    }
  }

  if (!parts.length) return null;
  return `context: ${parts.join(" · ")}`;
}

export function composeAspiresLine(meta: OnboardingMetaFromBodyNote): string | null {
  const comps = (meta.compliment_preferences ?? [])
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 2);
  if (!comps.length) return null;
  return `aspires: compliments ${comps.map((c) => `"${c}"`).join(", ")}`;
}

/** Prompt/context hint only — never mutate occasion_context from lifestyle tags. */
export function inferOccasionFromLifestyle(
  lifestyleTags: string[] | undefined,
): { occasion: string; framing: string } | null {
  if (!lifestyleTags?.length) return null;
  const set = new Set(lifestyleTags.map((t) => t.toLowerCase()));
  if (set.has("deep_in_career") || set.has("running_the_show")) {
    return {
      occasion: "work",
      framing: "for the office, I assume — say the word if it's for something else",
    };
  }
  if (set.has("campus_life") || set.has("first_job")) {
    return {
      occasion: "campus/casual",
      framing: "for campus/everyday, I assume — say the word if it's for something else",
    };
  }
  if (set.has("kids_in_the_mix")) {
    return {
      occasion: "practical everyday",
      framing: "for practical everyday, I assume — say the word if it's for something else",
    };
  }
  return null;
}

export function rankSignalsForRouter(params: {
  signals: StyleSignalRow[];
  occasionHint?: string | null;
  now?: Date;
  limit?: number;
}): StyleSignalRow[] {
  const limit = params.limit ?? 8;
  const filtered = filterSignalsByEffectiveConfidence(
    params.signals,
    undefined,
    params.now,
  ).filter((s) => s.status === "active");
  const family = params.occasionHint
    ? OCCASION_FAMILIES.find((f) => f.family === params.occasionHint)
    : null;
  const preferred = new Set(family?.signalContexts ?? []);

  const scored = filtered.map((signal) => {
    let score = signal.confidence;
    const ctx = signal.context?.toLowerCase() ?? "general";
    if (preferred.size && preferred.has(ctx)) score += 2;
    if (signal.source === "stated") score += 0.5;
    return { signal, score };
  });

  const ranked = scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.signal.last_seen_at.localeCompare(a.signal.last_seen_at),
  );
  const seen = new Set<string>();
  const out: StyleSignalRow[] = [];
  for (const row of ranked) {
    const key = `${row.signal.signal_type}:${signalCanonicalKey(row.signal).toLowerCase()}:${row.signal.polarity}:${row.signal.context}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row.signal);
    if (out.length >= limit) break;
  }
  return out;
}

export function formatRecentPicksLine(
  events: RequestEventRow[] | null | undefined,
): string | null {
  if (!events?.length) return null;
  const sorted = [...events].sort((a, b) => {
    const ap = a.attributes.kind === "purchase" ? 0 : 1;
    const bp = b.attributes.kind === "purchase" ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return Date.parse(b.created_at) - Date.parse(a.created_at);
  });
  const byFamily = new Map<string, { label: string; date: string }>();
  for (const event of sorted) {
    const garment = event.attributes.garment?.trim();
    if (!garment) continue;
    const primary = garment.split(",")[0]?.trim() ?? garment;
    const family = primary.toLowerCase().replace(/s$/, "") || primary.toLowerCase();
    if (byFamily.has(family)) continue;
    const day = event.created_at.slice(0, 10);
    const bought = event.attributes.kind === "purchase";
    if (bought) {
      const brand = event.attributes.brand?.trim();
      const color = event.attributes.color?.trim();
      const detail = [brand, color].filter(Boolean).join(", ");
      const label = detail
        ? `${primary} — ${detail} (bought ${day})`
        : `${primary} (bought ${day})`;
      byFamily.set(family, { label, date: day });
    } else {
      const bits = [
        event.attributes.color?.trim(),
        event.attributes.brand?.trim(),
        event.attributes.style?.trim(),
      ].filter(Boolean);
      const title =
        bits.length > 0
          ? bits
              .map((b) => b!.charAt(0).toUpperCase() + b!.slice(1))
              .join(" ")
          : primary;
      byFamily.set(family, { label: `"${title}"`, date: day });
    }
    if (byFamily.size >= 3) break;
  }
  if (!byFamily.size) return null;
  const parts = [...byFamily.entries()].map(([family, row]) =>
    row.label.includes("(bought ")
      ? row.label
      : `${family} → ${row.label} (${row.date})`,
  );
  return `recent_picks: ${parts.join("; ")}`;
}

/** Garment families the client already bought or searched — named for the unnamed gate. */
export function garmentFamiliesFromRequestEvents(
  events: RequestEventRow[] | null | undefined,
): Set<string> {
  const named = new Set<string>();
  for (const event of events ?? []) {
    const raw = event.attributes.garment?.trim();
    if (!raw) continue;
    for (const part of raw.split(",")) {
      const k = garmentSlotFamilyKey(part.trim());
      if (k) named.add(k);
    }
  }
  return named;
}

export function formatLastSearchLine(params: {
  event: RequestEventRow | null | undefined;
  personRelation?: string | null;
  now?: Date;
}): string | null {
  if (!params.event) return null;
  const created = Date.parse(params.event.created_at);
  if (!Number.isFinite(created)) return null;
  const now = (params.now ?? new Date()).getTime();
  const ageMs = now - created;
  if (ageMs < 0 || ageMs > 14 * 24 * 60 * 60 * 1000) return null;

  const attrs = params.event.attributes as RequestEventAttributes;
  const garment = attrs.garment?.trim();
  const occasion = attrs.occasion?.trim();
  if (!garment && !occasion) return null;

  const days = Math.max(0, Math.floor(ageMs / (24 * 60 * 60 * 1000)));
  const when =
    days === 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
  const forWhom =
    params.personRelation === "self" || !params.personRelation
      ? "self"
      : params.personRelation;
  const what = [garment, occasion].filter(Boolean).join(", ");
  return `last_search: ${what} (${when}, for ${forWhom})`;
}

/** Taste-tag category → signal context for occasion ranking. */
export function contextForTasteCategory(category: string | null | undefined): string {
  const c = category?.trim().toLowerCase() ?? "";
  if (c === "worn") return "everyday";
  if (c === "aspirational") return "elevated";
  if (c === "compliment") return "general";
  if (c === "fashion" || c === "outfit" || c === "style") return "general";
  return c || "general";
}
