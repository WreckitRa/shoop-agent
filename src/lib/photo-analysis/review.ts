import {
  isAssessment,
  type StylePhotoAnalysis,
} from "./result";

export type ReviewCorrection = {
  path: string;
  previous_value: string | null;
  corrected_value: string;
};

export type StyleUserReview = {
  confirmed_paths: string[];
  corrections: ReviewCorrection[];
  rejected_paths: string[];
  notes: string[];
  submitted_at: string;
};

export type ReviewableAssessment = {
  path: string;
  section: string;
  label: string;
  value: string | null;
  confidence: number;
  evidence: string;
};

const PROFILE_SECTIONS: Array<{
  key: keyof StylePhotoAnalysis["visible_profile"];
  section: string;
}> = [
  { key: "color", section: "Colour" },
  { key: "face", section: "Face" },
  { key: "hair_and_grooming", section: "Hair & grooming" },
  { key: "body_proportions", section: "Proportions" },
  { key: "current_style_signals", section: "Current style" },
];

function labelOf(key: string): string {
  return key.replace(/_/g, " ");
}

export function listReviewableAssessments(
  analysis: StylePhotoAnalysis,
): ReviewableAssessment[] {
  const rows: ReviewableAssessment[] = [];
  for (const { key, section } of PROFILE_SECTIONS) {
    const group = analysis.visible_profile[key];
    if (!group || typeof group !== "object") continue;
    for (const [field, raw] of Object.entries(group)) {
      if (!isAssessment(raw)) continue;
      rows.push({
        path: `visible_profile.${key}.${field}`,
        section,
        label: labelOf(field),
        value: raw.value,
        confidence: raw.confidence,
        evidence: raw.evidence,
      });
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
  return raw as StyleUserReview;
}

export function buildStyleUserReview(opts: {
  rows: ReviewableAssessment[];
  edits: Record<string, string>;
  rejected: string[];
  notes: string;
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
  };
}
