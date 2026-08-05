import { PERSON_NAME_SKIP_OPTION } from "../extraction/person-identity";
import type {
  FashionClarificationAnswer,
  FashionClarificationGap,
  FashionClarificationOption,
  FashionClarificationQuestion,
  FashionClarificationRideAlong,
  MessageFashionRouterMetaV1,
} from "./types";
import type { ClarificationOptionPreviewImage } from "@/lib/ai-chat/types";

const OTHER = "Other";
const OTHER_ID = "other";

const GENERIC_STYLE_LABELS = [
  "Minimal",
  "Classic",
  "Streetwear",
  "Relaxed",
] as const;

/**
 * Taste-derived style/vibe chips from positive style signals.
 * Cold profile → null (caller keeps generic archetype chips).
 */
export function personalizedStyleOptions(params: {
  signals: Array<{
    signal_type: string;
    value: string;
    polarity: number;
  }>;
  departmentLabel?: string;
  limit?: number;
}): FashionClarificationOption[] | null {
  const positives = params.signals
    .filter(
      (s) =>
        s.polarity === 1 &&
        (s.signal_type === "style" ||
          s.signal_type === "aesthetic" ||
          s.signal_type === "silhouette"),
    )
    .map((s) => s.value.trim())
    .filter(Boolean);
  const unique: string[] = [];
  for (const v of positives) {
    const key = v.toLowerCase();
    if (unique.some((u) => u.toLowerCase() === key)) continue;
    unique.push(v);
    if (unique.length >= (params.limit ?? 3)) break;
  }
  if (!unique.length) return null;

  const dept = params.departmentLabel?.trim() || "clothing";
  const opts: FashionClarificationOption[] = unique.map((label) => ({
    id: slugifyOptionId(label),
    label: label.charAt(0).toUpperCase() + label.slice(1),
    previewQuery: `${label.toLowerCase()} ${dept} outfit clothing`,
  }));

  const contrast =
    GENERIC_STYLE_LABELS.find(
      (g) => !unique.some((u) => u.toLowerCase().includes(g.toLowerCase())),
    ) ?? "Bold";
  opts.push({
    id: slugifyOptionId(contrast),
    label: contrast,
    previewQuery: `${contrast.toLowerCase()} ${dept} outfit clothing`,
  });
  opts.push({ id: "surprise_me", label: "Surprise me" });
  return opts;
}

/** Color ride-along chips from positive color signals. */
export function personalizedColorOptions(params: {
  signals: Array<{
    signal_type: string;
    value: string;
    polarity: number;
  }>;
  limit?: number;
}): FashionClarificationOption[] | null {
  const positives = params.signals
    .filter((s) => s.polarity === 1 && s.signal_type === "color")
    .map((s) => s.value.trim())
    .filter(Boolean);
  const unique: string[] = [];
  for (const v of positives) {
    const key = v.toLowerCase();
    if (unique.some((u) => u.toLowerCase() === key)) continue;
    unique.push(v);
    if (unique.length >= (params.limit ?? 3)) break;
  }
  if (!unique.length) return null;
  const opts: FashionClarificationOption[] = unique.map((label) => ({
    id: slugifyOptionId(label),
    label: label.charAt(0).toUpperCase() + label.slice(1),
    previewQuery: `${label.toLowerCase()} clothing`,
  }));
  opts.push({ id: "surprise_me", label: "Surprise me" });
  return opts;
}

function looksLikeStyleRideAlong(text: string): boolean {
  return /\b(style|vibe|aesthetic|look|direction)\b/i.test(text);
}

function looksLikeColorRideAlong(text: string): boolean {
  return /\b(color|palette|shade)\b/i.test(text);
}

/** Prefer profile aesthetics over generic archetype chips when signals exist. */
export function personalizeClarificationOptions(params: {
  questions: FashionClarificationQuestion[];
  rideAlong?: FashionClarificationRideAlong;
  signals?: Array<{
    signal_type: string;
    value: string;
    polarity: number;
  }>;
  departmentLabel?: string;
}): {
  questions: FashionClarificationQuestion[];
  ride_along?: FashionClarificationRideAlong;
} {
  const signals = params.signals ?? [];
  const styleOpts = personalizedStyleOptions({
    signals,
    departmentLabel: params.departmentLabel,
  });
  const colorOpts = personalizedColorOptions({ signals });

  const questions = params.questions.map((q) => {
    if (q.gap === "occasion") return q;
    if (looksLikeStyleRideAlong(q.text) && styleOpts) {
      return { ...q, quick_options: styleOpts };
    }
    if (looksLikeColorRideAlong(q.text) && colorOpts) {
      return { ...q, quick_options: colorOpts };
    }
    return q;
  });

  let ride_along = params.rideAlong;
  if (ride_along) {
    if (looksLikeStyleRideAlong(ride_along.text) && styleOpts) {
      ride_along = { ...ride_along, quick_options: styleOpts };
    } else if (looksLikeColorRideAlong(ride_along.text) && colorOpts) {
      ride_along = { ...ride_along, quick_options: colorOpts };
    }
  }

  return { questions, ride_along };
}

/** Default chips when the LLM omits quick_options for a known gap. */
export function defaultQuickOptionsForGap(
  gap: FashionClarificationGap,
  garmentType?: string,
): string[] {
  const bucket = garmentType?.trim().toLowerCase() ?? "";
  switch (gap) {
    case "department":
      return ["Men's", "Women's", "Mix it", OTHER];
    case "size":
      if (bucket === "shoes" || /\bshoe/.test(bucket)) {
        return ["7", "8", "9", "10", "11", OTHER];
      }
      if (bucket === "bottoms" || /\b(pant|trouser|waist)/.test(bucket)) {
        return ["28", "30", "32", "34", "36", OTHER];
      }
      if (bucket === "dresses" || /\bdress/.test(bucket)) {
        return ["XS", "S", "M", "L", "XL", OTHER];
      }
      // tops / unknown size
      return ["XS", "S", "M", "L", "XL", OTHER];
    case "recipient":
      return ["For me", "Someone else", OTHER];
    case "person_name":
      // Free text + Skip only — never seed roster names.
      return [PERSON_NAME_SKIP_OPTION];
    case "garment":
      return ["One piece", "Full outfit", "A few options", OTHER];
    case "occasion":
      return ["Work", "Weekend", "Event / night out", OTHER];
    case "budget":
      return ["$150", "$250", "$400", OTHER];
    default:
      return [OTHER];
  }
}

export function slugifyOptionId(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64);
  return slug || "option";
}

export function isOtherOption(
  option: string | FashionClarificationOption,
): boolean {
  if (typeof option === "string") {
    return option.trim().toLowerCase() === OTHER.toLowerCase();
  }
  return (
    option.id === OTHER_ID ||
    option.label.trim().toLowerCase() === OTHER.toLowerCase()
  );
}

export function normalizeClarificationOption(
  raw: string | FashionClarificationOption,
): FashionClarificationOption {
  if (typeof raw === "string") {
    const label = raw.trim();
    if (label.toLowerCase() === OTHER.toLowerCase()) {
      return { id: OTHER_ID, label: OTHER };
    }
    return { id: slugifyOptionId(label), label };
  }
  const label = raw.label.trim() || raw.id.trim();
  const id =
    raw.id.trim() ||
    (label.toLowerCase() === OTHER.toLowerCase()
      ? OTHER_ID
      : slugifyOptionId(label));
  const previewQuery = raw.previewQuery?.trim() || undefined;
  return {
    id,
    label,
    ...(previewQuery ? { previewQuery } : {}),
    ...(raw.previewImages?.length ? { previewImages: raw.previewImages } : {}),
  };
}

export function asNormalizedOptions(
  options?: Array<string | FashionClarificationOption>,
): FashionClarificationOption[] {
  return (options ?? []).map(normalizeClarificationOption).filter((o) => o.label);
}

export function optionLabels(
  options?: Array<string | FashionClarificationOption>,
): string[] {
  return asNormalizedOptions(options).map((o) => o.label);
}

/** Gaps that default to multi-select when the LLM omits allow_multiple. */
export function defaultAllowMultipleForGap(gap: FashionClarificationGap): boolean {
  return gap === "occasion";
}

function gapAllowsOther(question: FashionClarificationQuestion): boolean {
  if (question.gap === "person_name") return false;
  if (question.allow_other === false) return false;
  return true;
}

/**
 * Ensure every clarification question has tappable options, always ending
 * with Other so free-form answers are available — except person_name (Skip only).
 * Coerces string chips into rich options and applies multi-select defaults.
 */
export function ensureClarificationQuickOptions(
  question: FashionClarificationQuestion,
): FashionClarificationQuestion {
  const allowMultiple =
    question.allow_multiple ?? defaultAllowMultipleForGap(question.gap);

  if (question.gap === "person_name") {
    return {
      ...question,
      allow_multiple: false,
      allow_other: false,
      quick_options: [{ id: "skip", label: PERSON_NAME_SKIP_OPTION }],
    };
  }

  const existing = asNormalizedOptions(question.quick_options).filter(
    (o) => !isOtherOption(o),
  );
  const base =
    existing.length >= 2
      ? existing
      : asNormalizedOptions(
          defaultQuickOptionsForGap(question.gap, question.garment_type),
        ).filter((o) => !isOtherOption(o));

  const capped = base.slice(0, 5);
  const withOther = gapAllowsOther(question)
    ? [...capped, { id: OTHER_ID, label: OTHER }]
    : capped;

  return {
    ...question,
    allow_multiple: allowMultiple,
    allow_other: gapAllowsOther(question),
    quick_options: withOther,
  };
}

export function ensureQuestionsHaveQuickOptions(
  questions: FashionClarificationQuestion[],
): FashionClarificationQuestion[] {
  return questions.map(ensureClarificationQuickOptions);
}

export function ensureRideAlongDefaults(
  rideAlong: FashionClarificationRideAlong | undefined,
): FashionClarificationRideAlong | undefined {
  if (!rideAlong) return undefined;
  const allowOther = rideAlong.allow_other !== false;
  const existing = asNormalizedOptions(rideAlong.quick_options).filter(
    (o) => !isOtherOption(o),
  );
  const capped = existing.slice(0, 5);
  const quick_options = allowOther
    ? [...capped, { id: OTHER_ID, label: OTHER }]
    : capped;
  return {
    ...rideAlong,
    allow_multiple: rideAlong.allow_multiple ?? true,
    allow_other: allowOther,
    quick_options,
  };
}

export function formatClarificationAnswerDisplay(
  answer: FashionClarificationAnswer | undefined,
  options?: Array<string | FashionClarificationOption>,
): string {
  if (answer == null) return "";

  const opts = asNormalizedOptions(options);
  const byId = new Map(opts.map((o) => [o.id, o.label]));
  const byLabel = new Map(opts.map((o) => [o.label.toLowerCase(), o.label]));

  const labels: string[] = [];
  for (const sel of answer.selected) {
    const t = sel.trim();
    if (!t || t.toLowerCase() === OTHER.toLowerCase() || t === OTHER_ID) continue;
    labels.push(byId.get(t) ?? byLabel.get(t.toLowerCase()) ?? t);
  }
  const custom = answer.customText?.trim();
  if (custom) labels.push(custom);
  return labels.join(", ");
}

export function answerHasContent(
  answer: FashionClarificationAnswer | undefined,
): boolean {
  return Boolean(formatClarificationAnswerDisplay(answer));
}

/** Collect option preview fetch requests from fashion router meta. */
export function collectFashionPreviewRequests(
  meta: Pick<MessageFashionRouterMetaV1, "questions" | "ride_along">,
): Array<{ id: string; previewQuery: string }> {
  const out: Array<{ id: string; previewQuery: string }> = [];
  const seen = new Set<string>();
  const pushOpt = (o: FashionClarificationOption) => {
    const q = o.previewQuery?.trim();
    if (!q || o.id === OTHER_ID || seen.has(o.id)) return;
    if (o.previewImages?.length) return;
    seen.add(o.id);
    out.push({ id: o.id, previewQuery: q });
  };
  for (const question of meta.questions ?? []) {
    for (const o of asNormalizedOptions(question.quick_options)) pushOpt(o);
  }
  if (meta.ride_along) {
    for (const o of asNormalizedOptions(meta.ride_along.quick_options)) {
      pushOpt(o);
    }
  }
  return out;
}

export function fashionRouterExpectsOptionPreviews(
  meta: Pick<MessageFashionRouterMetaV1, "questions" | "ride_along">,
): boolean {
  return collectFashionPreviewRequests(meta).length > 0;
}

export function mergeOptionPreviewsIntoFashionRouter(
  fashionRouter: MessageFashionRouterMetaV1,
  previews: Record<string, ClarificationOptionPreviewImage[] | undefined>,
): MessageFashionRouterMetaV1 {
  if (!Object.keys(previews).length) return fashionRouter;

  const patchOptions = (
    options?: Array<string | FashionClarificationOption>,
  ): FashionClarificationOption[] | undefined => {
    if (!options?.length) return asNormalizedOptions(options);
    return asNormalizedOptions(options).map((o) => {
      const images = previews[o.id];
      if (!images?.length) return o;
      return { ...o, previewImages: images };
    });
  };

  const questions = fashionRouter.questions?.map((q) => ({
    ...q,
    quick_options: patchOptions(q.quick_options),
  }));
  const ride_along = fashionRouter.ride_along
    ? {
        ...fashionRouter.ride_along,
        quick_options: patchOptions(fashionRouter.ride_along.quick_options)!,
      }
    : undefined;

  const next: MessageFashionRouterMetaV1 = {
    ...fashionRouter,
    ...(questions ? { questions } : {}),
    ...(ride_along ? { ride_along } : {}),
  };
  next.expectsOptionPreviews = collectFashionPreviewRequests(next).length > 0;
  return next;
}

export { OTHER as CLARIFICATION_OTHER_OPTION, OTHER_ID as CLARIFICATION_OTHER_OPTION_ID };
