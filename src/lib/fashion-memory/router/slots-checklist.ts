/**
 * Default / enriched slots checklists for outfit + capsule pull sheets.
 * Capsule lists are the full mixable set for the rotation — never thinner
 * than the client needs to compose looks_wanted outfits.
 */
import { garmentSlotFamilyKey } from "./garment-family";
import {
  asNormalizedOptions,
  CLARIFICATION_OTHER_OPTION_ID,
  SLOTS_ADD_PIECE_LABEL,
  slugifyOptionId,
} from "./clarification-defaults";
import type {
  FashionClarificationOption,
  FashionClarificationQuestion,
  FashionSearchBrief,
} from "./types";

export { SLOTS_ADD_PIECE_LABEL };

function isBeachish(occasion?: string | null): boolean {
  return /\b(beach|pool|resort|swim|vacation|holiday|été|mer)\b/i.test(
    occasion ?? "",
  );
}

export function isDressy(
  occasion?: string | null,
  formality?: string | null,
): boolean {
  const blob = `${occasion ?? ""} ${formality ?? ""}`;
  return /\b(wedding|baptism|ceremony|gala|formal|dressy|black.?tie|soirée|cérémonie)\b/i.test(
    blob,
  );
}

/** Head-to-toe outfit checklist (preselected core + optional layer). */
export function defaultOutfitSlotsOptions(params: {
  occasion?: string | null;
  formality?: string | null;
}): FashionClarificationOption[] {
  if (isDressy(params.occasion, params.formality)) {
    return [
      opt("Dress or separates", true),
      opt("Blazer", true),
      opt("Trousers", false),
      opt("Top", false),
      opt("Shoes", true),
    ];
  }
  return [
    opt("Top", true),
    opt("Bottoms", true),
    opt("Shoes", true),
    opt("Light layer", false),
  ];
}

/**
 * Capsule / rotation: full mixable set — enough families to compose
 * looks_wanted outfits without inventing garments mid-search.
 */
export function defaultCapsuleSlotsOptions(params: {
  occasion?: string | null;
  formality?: string | null;
  looksWanted?: number | null;
}): FashionClarificationOption[] {
  const looks = Math.max(2, Math.min(8, params.looksWanted ?? 3));
  const core: FashionClarificationOption[] = [
    opt("Tops", true),
    opt("Bottoms", true),
    opt("Shoes", true),
    opt("Light jacket", looks >= 3),
  ];
  if (isBeachish(params.occasion)) {
    core.push(opt("Swim", true), opt("Cover-up", false));
  } else if (isDressy(params.occasion, params.formality)) {
    core.push(opt("Dresses", true), opt("Blazer", true));
  } else {
    core.push(opt("Dresses", false), opt("Knitwear", false));
  }
  // Guarantee at least looks distinct families (rotation needs mixables).
  while (core.length < looks + 1) {
    const extras = [
      opt("Accessories", false),
      opt("Coat", false),
      opt("Bag", false),
    ];
    const next = extras.find(
      (e) => !core.some((c) => garmentSlotFamilyKey(c.label) === garmentSlotFamilyKey(e.label)),
    );
    if (!next) break;
    core.push(next);
  }
  return core.slice(0, 8);
}

function opt(label: string, preselected: boolean): FashionClarificationOption {
  return {
    id: slugifyOptionId(label),
    label,
    ...(preselected ? { preselected: true } : {}),
  };
}

function familyKey(label: string): string {
  return garmentSlotFamilyKey(label);
}

/** Merge LLM chips with defaults; keep LLM label when families collide. */
export function mergeSlotsOptionsByFamily(
  existing: FashionClarificationOption[],
  defaults: FashionClarificationOption[],
): FashionClarificationOption[] {
  const out: FashionClarificationOption[] = [];
  const seen = new Set<string>();
  for (const o of existing) {
    const k = familyKey(o.label);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(o);
  }
  for (const o of defaults) {
    const k = familyKey(o.label);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(o);
  }
  return out.slice(0, 8);
}

/**
 * Ensure slots questions carry a usable checklist + "Add a piece".
 * Capsule never ships fewer families than the rotation needs.
 */
export function enrichSlotsChecklistQuestion(
  question: FashionClarificationQuestion,
  brief: Pick<
    FashionSearchBrief,
    "request_type" | "occasion_context" | "depth" | "style_direction"
  > | null | undefined,
): FashionClarificationQuestion {
  if (question.gap !== "slots") return question;

  const occasion =
    typeof brief?.occasion_context === "string" ? brief.occasion_context : null;
  const formality =
    typeof brief?.style_direction === "string" ? brief.style_direction : null;
  const looks = brief?.depth?.looks_wanted ?? null;
  const existing = asNormalizedOptions(question.quick_options).filter(
    (o) =>
      o.id !== CLARIFICATION_OTHER_OPTION_ID &&
      !/^other$/i.test(o.label) &&
      !/^add a piece$/i.test(o.label),
  );

  const requestType = brief?.request_type;
  let merged = existing;
  if (requestType === "capsule") {
    const defaults = defaultCapsuleSlotsOptions({
      occasion,
      formality,
      looksWanted: looks,
    });
    const minFamilies = Math.max(4, looks ?? 3);
    if (existing.length < minFamilies) {
      merged = mergeSlotsOptionsByFamily(existing, defaults);
    }
  } else if (requestType === "outfit" && existing.length < 3) {
    merged = mergeSlotsOptionsByFamily(
      existing,
      defaultOutfitSlotsOptions({ occasion, formality }),
    );
  } else if (!existing.length && requestType === "outfit") {
    merged = defaultOutfitSlotsOptions({ occasion, formality });
  }

  // Dressy/formal: jacket layer must be on the checklist and preselected.
  if (isDressy(occasion, formality)) {
    const hasJacket = merged.some((o) =>
      /\b(blazer|jacket|coat|layer)\b/i.test(o.label),
    );
    if (!hasJacket) {
      merged = mergeSlotsOptionsByFamily(merged, [
        { id: "blazer", label: "Blazer", preselected: true },
      ]);
    } else {
      merged = merged.map((o) =>
        /\b(blazer|jacket|coat)\b/i.test(o.label)
          ? { ...o, preselected: true }
          : o,
      );
    }
  }

  return {
    ...question,
    allow_multiple: true,
    allow_other: true,
    display: question.display ?? "checklist",
    quick_options: [
      ...merged,
      { id: CLARIFICATION_OTHER_OPTION_ID, label: SLOTS_ADD_PIECE_LABEL },
    ],
  };
}

/** Build a fresh slots ask for the post-router gate. */
export function buildSlotsGateQuestion(
  brief: FashionSearchBrief,
): FashionClarificationQuestion {
  return enrichSlotsChecklistQuestion(
    {
      text: "What should I pull?",
      gap: "slots",
      kind: "consult",
      allow_multiple: true,
      allow_other: true,
      display: "checklist",
      quick_options: [],
    },
    brief,
  );
}
