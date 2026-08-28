/**
 * Chip→brief consistency: when the user answered depth/slots/color/budget
 * this turn, the ready brief must match. One LLM retry, then hard-set.
 */
import { garmentSlotFamilyKey } from "../router/garment-family";
import { parsePreferenceAnchorFromWords } from "../router/anchor-gate";
import type {
  FashionClarificationQuestion,
  FashionSearchBrief,
} from "../router/types";
import { normalizeGarmentClarificationAnswer } from "./garment-answer";

export type ConsistencyGap =
  | "depth"
  | "slots"
  | "color"
  | "budget"
  | "preference_anchor";

const hardsetCounts = new Map<ConsistencyGap, number>();

/** Eval/report: count hard-sets per gap for the process lifetime. */
export function noteBriefHardset(gap: ConsistencyGap): void {
  hardsetCounts.set(gap, (hardsetCounts.get(gap) ?? 0) + 1);
}

export function takeBriefHardsetCounts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of hardsetCounts) out[k] = v;
  hardsetCounts.clear();
  return out;
}

export type ChipAnswers = {
  depthLooks?: number;
  depthOptions?: number;
  depthYouDecide?: boolean;
  slotsGarments?: string[];
  color?: string;
  budgetMax?: number;
  preferenceAnchor?: "keep" | "push" | "explore";
};

export type ConsistencyMismatch = {
  gap: ConsistencyGap;
  chip: string;
  brief: string;
};

function driftFamilyKey(garment: string): string {
  const k = garmentSlotFamilyKey(garment);
  if (k === "pant" || k === "trouser" || k === "bottom") return "trousers";
  if (k === "sneaker" || k === "trainer") return "sneakers";
  if (k === "shoe") return "shoes";
  if (k === "top") return "shirt";
  return k;
}

function familySetsEqual(a: string[], b: string[]): boolean {
  const sa = new Set(a.map(driftFamilyKey).filter(Boolean));
  const sb = new Set(b.map(driftFamilyKey).filter(Boolean));
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

/** Parse depth chip / free text ("2 looks", "3", "You decide"). */
export function parseDepthChipAnswer(raw: string): {
  looks?: number;
  options?: number;
  youDecide?: boolean;
} | null {
  const t = raw.trim();
  if (!t) return null;
  if (/you decide|surprise me/i.test(t)) return { youDecide: true };
  const looks = t.match(/\b(\d+)\s*looks?\b/i);
  if (looks) {
    const n = Number(looks[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 8) return { looks: n };
  }
  const options = t.match(/\b(\d+)\s*options?\b/i);
  if (options) {
    const n = Number(options[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 8) return { options: n };
  }
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    if (Number.isFinite(n) && n >= 1 && n <= 8) return { looks: n };
  }
  return null;
}

export function parseColorChipAnswer(raw: string): string | null {
  const t = raw.trim();
  if (!t || /you decide|surprise me/i.test(t)) return null;
  return t.slice(0, 48);
}

export function parseBudgetChipAnswer(raw: string): number | null {
  const m = raw.replace(/,/g, "").match(/\$?\s*(\d{2,5})/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export function findConsistencyMismatches(params: {
  brief: FashionSearchBrief;
  chips: ChipAnswers;
}): ConsistencyMismatch[] {
  const out: ConsistencyMismatch[] = [];
  const { brief, chips } = params;

  if (chips.depthYouDecide) {
    if (brief.depth?.source !== "you_decide") {
      out.push({
        gap: "depth",
        chip: "you_decide",
        brief: brief.depth?.source ?? "missing",
      });
    }
  } else if (chips.depthLooks != null) {
    if (
      brief.depth?.looks_wanted !== chips.depthLooks ||
      (brief.depth?.source !== "stated" && brief.depth?.source !== "you_decide")
    ) {
      out.push({
        gap: "depth",
        chip: String(chips.depthLooks),
        brief: String(brief.depth?.looks_wanted ?? "missing"),
      });
    }
  } else if (chips.depthOptions != null) {
    if (brief.depth?.options_per_item !== chips.depthOptions) {
      out.push({
        gap: "depth",
        chip: `options:${chips.depthOptions}`,
        brief: String(brief.depth?.options_per_item ?? "missing"),
      });
    }
  }

  if (chips.slotsGarments?.length) {
    if (!familySetsEqual(brief.garments, chips.slotsGarments)) {
      out.push({
        gap: "slots",
        chip: chips.slotsGarments.join(","),
        brief: brief.garments.join(",") || "empty",
      });
    }
  }

  if (chips.color) {
    const colors = brief.color_direction?.stated_colors ?? [];
    const briefColor = colors[0] ?? "";
    const style = (brief.style_direction ?? "").toLowerCase();
    const colorLower = chips.color.toLowerCase();
    const present =
      (briefColor &&
        (briefColor.toLowerCase().includes(colorLower) ||
          colorLower.includes(briefColor.toLowerCase()))) ||
      style.includes(colorLower);
    if (!present) {
      out.push({
        gap: "color",
        chip: chips.color,
        brief: briefColor || "absent",
      });
    }
  }

  if (chips.budgetMax != null) {
    const max = brief.budget_context?.max;
    if (max !== chips.budgetMax) {
      out.push({
        gap: "budget",
        chip: String(chips.budgetMax),
        brief: max != null ? String(max) : "absent",
      });
    }
  }

  if (chips.preferenceAnchor) {
    const briefAnchor = brief.preference_anchor ?? "unspecified";
    if (briefAnchor !== chips.preferenceAnchor) {
      out.push({
        gap: "preference_anchor",
        chip: chips.preferenceAnchor,
        brief: briefAnchor,
      });
    }
  }

  return out;
}

export function hardSetBriefFromChips(
  brief: FashionSearchBrief,
  chips: ChipAnswers,
  gaps: ConsistencyGap[],
): FashionSearchBrief {
  let next = { ...brief };
  for (const gap of gaps) {
    if (gap === "depth") {
      if (chips.depthYouDecide) {
        next = {
          ...next,
          depth: {
            ...(next.depth ?? {}),
            source: "you_decide",
          },
        };
      } else if (chips.depthLooks != null) {
        next = {
          ...next,
          depth: {
            ...(next.depth ?? {}),
            looks_wanted: chips.depthLooks,
            source: "stated",
          },
        };
      } else if (chips.depthOptions != null) {
        next = {
          ...next,
          depth: {
            ...(next.depth ?? {}),
            options_per_item: chips.depthOptions,
            source: "stated",
          },
        };
      }
    }
    if (gap === "slots" && chips.slotsGarments?.length) {
      const clean = chips.slotsGarments.filter(
        (g) => g.trim().length > 0 && g.trim().length <= 40 && !/[.!?]/.test(g),
      );
      // Normalize to families; empty → keep prior garments (not a slots answer).
      const recognized = [
        ...new Set(clean.flatMap((g) => normalizeGarmentClarificationAnswer(g))),
      ];
      if (recognized.length) next = { ...next, garments: recognized };
    }
    if (gap === "color" && chips.color) {
      next = {
        ...next,
        style_direction: next.style_direction?.trim()
          ? `${next.style_direction}; ${chips.color}`
          : chips.color,
        color_direction: {
          source: "stated",
          stated_colors: [chips.color],
        },
      };
    }
    if (gap === "budget" && chips.budgetMax != null) {
      next = {
        ...next,
        budget_context: {
          ...next.budget_context,
          stated: true,
          max: chips.budgetMax,
          currency: next.budget_context?.currency ?? "USD",
        },
      };
    }
    if (gap === "preference_anchor" && chips.preferenceAnchor) {
      next = {
        ...next,
        preference_anchor: chips.preferenceAnchor,
        // Confirmed chip — drop the keep-assumption fallback if present.
        assumptions: (next.assumptions ?? []).filter(
          (a) => !/usual lane|say the word for something new/i.test(a),
        ),
      };
    }
  }
  return next;
}

export function consistencyRetryNote(mismatches: ConsistencyMismatch[]): string {
  const parts = mismatches.map((m) => {
    if (m.gap === "slots") {
      return `Ask slots alignment, phrased around chip garments [${m.chip}]; do not reuse prior wording (brief had [${m.brief}]).`;
    }
    return `Ask ${m.gap} alignment, phrased around chip=${m.chip}; do not reuse prior wording (brief had ${m.brief}).`;
  });
  return parts.join(" ");
}

/** Collect chip answers from prior ask + this user message. */
export function chipsFromClarificationTurn(params: {
  questions: FashionClarificationQuestion[];
  userMessage: string;
  answers: Record<string, string>;
  slotsGarments?: string[];
}): ChipAnswers {
  const chips: ChipAnswers = {};
  if (params.slotsGarments?.length) {
    chips.slotsGarments = params.slotsGarments;
  }
  for (const q of params.questions) {
    const raw =
      params.answers[q.gap ?? ""] ??
      params.answers[q.field ?? ""] ??
      params.answers[q.text] ??
      (params.questions.length === 1 || q.gap === "depth"
        ? params.userMessage
        : "");
    if (!raw?.trim()) continue;
    if (q.gap === "depth") {
      const d = parseDepthChipAnswer(raw);
      if (d?.youDecide) chips.depthYouDecide = true;
      if (d?.looks != null) chips.depthLooks = d.looks;
      if (d?.options != null) chips.depthOptions = d.options;
    }
    if (q.gap === "color") {
      const c = parseColorChipAnswer(raw);
      if (c) chips.color = c;
    }
    if (q.gap === "budget") {
      const b = parseBudgetChipAnswer(raw);
      if (b != null) chips.budgetMax = b;
    }
    if (q.gap === "slots" && !chips.slotsGarments?.length) {
      // slots parsed upstream into slotsGarments
    }
    if (q.gap === "preference_anchor") {
      const a = parsePreferenceAnchorFromWords(raw);
      if (a) chips.preferenceAnchor = a;
    }
  }
  // Multi-ask pull sheet: depth number may appear as "2 looks" in free text
  if (chips.depthLooks == null && chips.depthYouDecide == null) {
    const d = parseDepthChipAnswer(params.userMessage);
    if (d?.youDecide) chips.depthYouDecide = true;
    if (d?.looks != null) chips.depthLooks = d.looks;
    if (d?.options != null) chips.depthOptions = d.options;
  }
  if (!chips.preferenceAnchor) {
    const a = parsePreferenceAnchorFromWords(params.userMessage);
    if (a) chips.preferenceAnchor = a;
  }
  return chips;
}
