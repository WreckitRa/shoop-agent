/**
 * PROFILES v2 helpers — structured context/tone/aspires lines and
 * occasion-aware signal ranking for the fashion router.
 */
import {
  BUDGET_OPTIONS,
  HONESTY_OPTIONS,
  STYLE_ERAS,
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

export function inferOccasionFamilyHint(text: string | undefined): string | null {
  if (!text?.trim()) return null;
  for (const row of OCCASION_FAMILIES) {
    if (row.keywords.test(text)) return row.family;
  }
  return null;
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
  if (v === "gentle") return `tone: honesty soft ("nudge kindly")`;
  if (v === "straight") return `tone: honesty balanced ("tell me straight")`;
  if (v === "no_mercy") return `tone: honesty high ("full stylist mode")`;
  const opt = HONESTY_OPTIONS.find((o) => o.value === v);
  return opt ? `tone: honesty ${opt.label.toLowerCase()}` : `tone: honesty ${v}`;
}

export function mapHonestyToVoice(
  honesty: string | null | undefined,
): "gentle" | "balanced" | "blunt" | undefined {
  const v = honesty?.trim().toLowerCase();
  if (v === "gentle") return "gentle";
  if (v === "straight") return "balanced";
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
  );
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

  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.signal.last_seen_at.localeCompare(a.signal.last_seen_at),
    )
    .slice(0, limit)
    .map((s) => s.signal);
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
