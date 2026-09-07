/**
 * Prose brief for the fitting verdict. LLMs write better from this than a JSON dump.
 */

import {
  BUDGET_OPTIONS,
  CLIMATE_OPTIONS,
  HONESTY_OPTIONS,
  KIDS_OPTIONS,
  WEEK_IS_OPTIONS,
  WEEKEND_OPTIONS,
  honestyToneChip,
  labelsForCsvValues,
  normalizeHonestyPreference,
  whyHereLabel,
} from "@/lib/onboarding/form-options";
import type { StylePhotoAnalysis } from "./result";
import type { StyleUserReview } from "./review";

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function asStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function nested(obj: unknown, ...keys: string[]): unknown {
  let cur: unknown = obj;
  for (const k of keys) {
    if (!isRecord(cur)) return null;
    cur = cur[k];
  }
  return cur;
}

function assessmentValue(obj: unknown, path: string): string {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (!isRecord(cur)) return "";
    cur = cur[part];
  }
  if (isRecord(cur) && typeof cur.value === "string") return cur.value.trim();
  return typeof cur === "string" ? cur.trim() : "";
}

type FactRow = { label: string; paths: string[] };

const FACE_FACTS: FactRow[] = [
  { label: "skin", paths: ["visible_profile.color.skin_depth"] },
  {
    label: "undertone",
    paths: ["visible_profile.color.undertone_hypothesis"],
  },
  { label: "contrast", paths: ["visible_profile.color.facial_contrast"] },
  { label: "eyes", paths: ["visible_profile.color.eye_color"] },
  { label: "hair colour", paths: ["visible_profile.color.hair_color"] },
  {
    label: "hair length",
    paths: ["visible_profile.hair_and_grooming.hair_length"],
  },
  {
    label: "hair texture",
    paths: ["visible_profile.hair_and_grooming.hair_texture"],
  },
  {
    label: "facial hair",
    paths: ["visible_profile.hair_and_grooming.facial_hair_style"],
  },
  { label: "face shape", paths: ["visible_profile.face.primary_shape"] },
  {
    label: "glasses",
    paths: ["visible_profile.hair_and_grooming.eyewear"],
  },
];

export function faceFactsLines(
  analysis: unknown,
  review: StyleUserReview | null | undefined,
): { lines: string[]; confirmed: boolean } {
  const corrections = new Map<string, string>();
  const rejected = new Set<string>();
  if (review) {
    for (const c of review.corrections) {
      corrections.set(c.path, c.corrected_value.trim());
    }
    for (const p of review.rejected_paths) rejected.add(p);
  }
  const lines: string[] = [];
  for (const row of FACE_FACTS) {
    let value = "";
    for (const path of row.paths) {
      if (rejected.has(path)) {
        value = "";
        break;
      }
      const edited = corrections.get(path);
      if (edited) {
        value = edited;
        break;
      }
      value = assessmentValue(analysis, path);
      if (value) break;
    }
    if (value) lines.push(`${row.label}: ${value}`);
  }
  return {
    lines,
    confirmed: Boolean(review?.submitted_at),
  };
}

function csvLine(
  options: readonly { value: string; label: string }[],
  raw: unknown,
): string {
  const labels = labelsForCsvValues(options, asStr(raw));
  return labels.join(", ");
}

function honestyTone(raw: unknown): "gentle" | "straight" | "blunt" {
  const chip = honestyToneChip(asStr(raw));
  if (chip === "1") return "gentle";
  if (chip === "5") return "blunt";
  return "straight";
}

function pronoun(gender: string): { they: string; clothing: string } {
  const g = gender.toLowerCase();
  if (g === "womenswear" || g === "feminine" || g === "womens") {
    return { they: "she", clothing: "Womenswear" };
  }
  if (g === "menswear" || g === "masculine" || g === "mens") {
    return { they: "he", clothing: "Menswear" };
  }
  return { they: "they", clothing: "Both menswear and womenswear" };
}

export function buildFittingVerdictBrief(input: {
  questionnaireAnswers: Record<string, unknown>;
  measurements: Record<string, unknown>;
  wardrobeInventory: Record<string, unknown>;
  applicationContext?: Record<string, unknown>;
  photoAnalysis?: unknown;
  userReview?: StyleUserReview | null;
  hasPhoto: boolean;
}): string {
  const q = input.questionnaireAnswers;
  const identity = isRecord(q.identity) ? q.identity : {};
  const lifestyle = isRecord(q.lifestyle) ? q.lifestyle : {};
  const taste = isRecord(q.taste) ? q.taste : {};
  const budget = isRecord(q.budget) ? q.budget : {};
  const location = isRecord(q.location) ? q.location : {};
  const body = isRecord(nested(input.measurements, "body"))
    ? (nested(input.measurements, "body") as Record<string, unknown>)
    : {};
  const wardrobe = input.wardrobeInventory;
  const name = asStr(identity.preferred_name) || asStr(identity.name) || "them";
  const gender = asStr(identity.gender_presentation);
  const { they, clothing } = pronoun(gender);
  const age =
    asStr(identity.age_range) ||
    (typeof identity.age_years === "number" ? String(identity.age_years) : "");
  const era = asStr(identity.style_era_label) || asStr(identity.style_era);
  const why =
    whyHereLabel(asStr(q.goal)) || asStr(q.goal_label) || asStr(q.goal);
  const week = csvLine(WEEK_IS_OPTIONS, lifestyle.week_is) || asStr(lifestyle.week_is_label);
  const weekends =
    csvLine(WEEKEND_OPTIONS, lifestyle.weekends_are) ||
    asStr(lifestyle.weekends_are_label);
  const kids = csvLine(KIDS_OPTIONS, lifestyle.kids) || asStr(lifestyle.kids_label);
  const climate =
    csvLine(CLIMATE_OPTIONS, asStr(q.climate)) || asStr(q.climate_label);
  const spend =
    csvLine(BUDGET_OPTIONS, asStr(budget.philosophy)) ||
    asStr(budget.philosophy_label);
  const tone = honestyTone(taste.honesty ?? input.applicationContext?.honesty);
  const toneN = normalizeHonestyPreference(asStr(taste.honesty)) || "3";
  const toneLabel = HONESTY_OPTIONS.find((c) => c.value === toneN)?.label;
  const corner = isRecord(taste.honest_corner) ? taste.honest_corner : {};
  const friction = asStr(corner.friction);
  const become = asStr(corner.become);
  const worn = Array.isArray(wardrobe.worn)
    ? wardrobe.worn.filter((x): x is string => typeof x === "string")
    : [];
  const compliments = Array.isArray(taste.compliments)
    ? taste.compliments.filter((x): x is string => typeof x === "string")
    : [];
  const likes = Array.isArray(wardrobe.brands_like)
    ? wardrobe.brands_like.filter((x): x is string => typeof x === "string")
    : [];
  const avoids = Array.isArray(wardrobe.brands_avoid)
    ? wardrobe.brands_avoid.filter((x): x is string => typeof x === "string")
    : [];
  const vetoes = Array.isArray(wardrobe.style_vetoes)
    ? wardrobe.style_vetoes
        .map((v) => {
          if (typeof v === "string") return v;
          if (!isRecord(v)) return "";
          const value = asStr(v.value);
          const note = asStr(v.note);
          return note ? `${value} (${note})` : value;
        })
        .filter(Boolean)
    : [];
  const comfort = Array.isArray(wardrobe.comfort)
    ? wardrobe.comfort
        .map((v) => {
          if (typeof v === "string") return v;
          if (!isRecord(v)) return "";
          const value = asStr(v.value);
          const note = asStr(v.note);
          return note && note !== "comfort" ? `${value} (${note})` : value;
        })
        .filter(Boolean)
    : [];

  const bodyBits = [
    typeof body.height_cm === "number" ? `${body.height_cm} cm` : "",
    typeof body.weight_kg === "number" ? `${body.weight_kg} kg` : "",
    asStr(body.body_type),
    asStr(body.body_shape),
    asStr(body.muscularity) ? `muscularity ${asStr(body.muscularity)}` : "",
    asStr(body.bust_fullness) ? `${asStr(body.bust_fullness)} bust` : "",
    asStr(body.leg_line) ? `legs ${asStr(body.leg_line)}` : "",
  ].filter(Boolean);

  const facts = faceFactsLines(input.photoAnalysis, input.userReview);
  const missing: string[] = [];
  if (!asStr(lifestyle.occupation)) missing.push("occupation");
  if (!asStr(location.city)) missing.push("city");
  if (!input.hasPhoto) missing.push("photo");

  const lines: string[] = [
    `Client: ${name}. ${clothing}. ${[age, era ? `Style era: ${era}` : ""]
      .filter(Boolean)
      .join(". ")}.`,
  ];
  if (why) lines.push(`Why ${they}'s here: ${why}.`);
  if (week) lines.push(`The week: ${week}.`);
  if (weekends) lines.push(`Weekends: ${weekends}.`);
  if (kids) lines.push(`Kids: ${kids}.`);
  if (climate) lines.push(`Climate: ${climate}.`);
  if (spend) lines.push(`Spend: ${spend}.`);
  if (bodyBits.length) {
    lines.push(
      `Body (declared, not from the photo): ${bodyBits.join(", ")}.`,
    );
  }
  if (worn.length) lines.push(`What ${they} wears now: ${worn.join(", ")}.`);
  if (compliments.length) {
    lines.push(`Compliments ${they} gets: ${compliments.join(", ")}.`);
  }
  if (friction) {
    lines.push(`In ${they === "they" ? "their" : they === "she" ? "her" : "his"} words — what's not working: "${friction}".`);
  }
  if (become) {
    lines.push(`Who ${they} wants to become: "${become}".`);
  }
  const law = [...comfort, ...vetoes];
  if (law.length) lines.push(`Vetoes (law): ${law.join("; ")}.`);
  if (avoids.length) lines.push(`Brands ${they} avoids: ${avoids.join(", ")}.`);
  if (likes.length) lines.push(`Brands ${they} likes: ${likes.join(", ")}.`);
  lines.push(`Tone: ${tone}${toneLabel ? ` (${toneLabel})` : ""}.`);
  if (facts.lines.length) {
    if (facts.confirmed) {
      lines.push(`Confirmed face facts: ${facts.lines.join("; ")}.`);
    } else {
      lines.push(
        `Face facts from the photo — ${they} hasn't confirmed these yet: ${facts.lines.join("; ")}. Build the palette from them anyway; don't hedge the reading.`,
      );
    }
  } else if (!input.hasPhoto) {
    lines.push(
      "No photo. Skip near_face and avoid_near_face. Build the palette from what they told you, and say in the reading that a photo unlocks colours.",
    );
  }
  if (missing.length) {
    lines.push(`Not provided: ${missing.join(", ")}. Don't guess them.`);
  }
  return lines.join("\n");
}

export type { StylePhotoAnalysis };
