import {
  isAssessment,
  type Assessment,
  type StylePhotoAnalysis,
} from "./result";

export type ReviewCorrection = {
  path: string;
  previous_value: string | null;
  corrected_value: string;
};

/** Body facts the user confirmed at scan review — not inferred from the photo. */
export type ConfirmedBody = {
  height_cm: number | null;
  weight_kg: number | null;
  body_type: string | null;
  muscularity: string | null;
  body_shape: string | null;
  bust_fullness: string | null;
  leg_line: string | null;
};

export type StyleUserReview = {
  confirmed_paths: string[];
  corrections: ReviewCorrection[];
  rejected_paths: string[];
  notes: string[];
  submitted_at: string;
  confirmed_body?: ConfirmedBody | null;
};

export type ReviewableAssessment = {
  path: string;
  section: string;
  label: string;
  value: string | null;
  confidence: number;
  evidence: string;
};

function assessmentAt(
  analysis: StylePhotoAnalysis,
  path: string,
): Assessment | null {
  let cur: unknown = analysis;
  for (const part of path.split(".")) {
    if (!cur || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[part];
  }
  return isAssessment(cur) ? cur : null;
}

/** Face-photo traits we ask the user to confirm — not the full technical profile. */
const CONFIRM_TRAITS: Array<{ label: string; paths: string[] }> = [
  {
    label: "Skin tone",
    paths: [
      "visible_profile.color.visible_skin_surface_tone",
      "visible_profile.color.skin_depth",
    ],
  },
  {
    label: "Undertone",
    paths: ["visible_profile.color.undertone_hypothesis"],
  },
  {
    label: "Contrast",
    paths: ["visible_profile.color.facial_contrast"],
  },
  { label: "Eyes", paths: ["visible_profile.color.eye_color"] },
  { label: "Hair", paths: ["visible_profile.color.hair_color"] },
  { label: "Face", paths: ["visible_profile.face.primary_shape"] },
  {
    label: "Hair length",
    paths: ["visible_profile.hair_and_grooming.hair_length"],
  },
  {
    label: "Facial hair",
    paths: ["visible_profile.hair_and_grooming.facial_hair_style"],
  },
];

export function listConfirmableTraits(
  analysis: StylePhotoAnalysis,
): ReviewableAssessment[] {
  const rows: ReviewableAssessment[] = [];
  for (const trait of CONFIRM_TRAITS) {
    for (const path of trait.paths) {
      const item = assessmentAt(analysis, path);
      const value = item?.value?.trim();
      if (!item || !value) continue;
      rows.push({
        path,
        section: "You",
        label: trait.label,
        value,
        confidence: item.confidence,
        evidence: item.evidence,
      });
      break;
    }
  }
  return rows;
}

export function parseStyleUserReview(raw: unknown): StyleUserReview | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.confirmed_paths)) return null;
  if (!Array.isArray(o.corrections)) return null;
  if (!Array.isArray(o.rejected_paths)) return null;
  if (!Array.isArray(o.notes)) return null;
  if (typeof o.submitted_at !== "string" || !o.submitted_at.trim()) return null;
  if (!o.confirmed_paths.every((v) => typeof v === "string")) return null;
  if (!o.rejected_paths.every((v) => typeof v === "string")) return null;
  if (!o.notes.every((v) => typeof v === "string")) return null;
  for (const item of o.corrections) {
    if (!item || typeof item !== "object") return null;
    const c = item as Record<string, unknown>;
    if (typeof c.path !== "string") return null;
    if (c.previous_value !== null && typeof c.previous_value !== "string") {
      return null;
    }
    if (typeof c.corrected_value !== "string") return null;
  }
  const confirmed_body = parseConfirmedBody(o.confirmed_body);
  if (o.confirmed_body !== undefined && o.confirmed_body !== null && !confirmed_body) {
    return null;
  }
  return {
    ...(raw as StyleUserReview),
    ...(confirmed_body ? { confirmed_body } : {}),
  };
}

export function parseConfirmedBody(raw: unknown): ConfirmedBody | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const str = (v: unknown) =>
    typeof v === "string" && v.trim() ? v.trim() : null;
  const num = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  return {
    height_cm: num(o.height_cm),
    weight_kg: num(o.weight_kg),
    body_type: str(o.body_type),
    muscularity: str(o.muscularity),
    body_shape: str(o.body_shape),
    bust_fullness: str(o.bust_fullness),
    leg_line: str(o.leg_line),
  };
}

export function buildStyleUserReview(opts: {
  rows: ReviewableAssessment[];
  edits: Record<string, string>;
  rejected: string[];
  notes: string;
  confirmedBody?: ConfirmedBody | null;
}): StyleUserReview {
  const rejectedSet = new Set(opts.rejected);
  const confirmed_paths: string[] = [];
  const corrections: ReviewCorrection[] = [];
  for (const row of opts.rows) {
    if (rejectedSet.has(row.path)) continue;
    const edit = opts.edits[row.path]?.trim();
    if (edit && edit !== (row.value ?? "")) {
      corrections.push({
        path: row.path,
        previous_value: row.value,
        corrected_value: edit,
      });
      continue;
    }
    confirmed_paths.push(row.path);
  }
  const notes = opts.notes.trim();
  return {
    confirmed_paths,
    corrections,
    rejected_paths: [...rejectedSet],
    notes: notes ? [notes] : [],
    submitted_at: new Date().toISOString(),
    ...(opts.confirmedBody ? { confirmed_body: opts.confirmedBody } : {}),
  };
}
