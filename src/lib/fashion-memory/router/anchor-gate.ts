/**
 * Preference-anchor gate: known clients must be asked "the usual, or
 * something new?" when profile knowledge overlaps the brief garments.
 */
import { garmentSlotFamilyKey } from "./garment-family";
import { garmentsKey } from "./consultation";
import type {
  FashionClarificationQuestion,
  FashionSearchBrief,
} from "./types";
import type {
  FashionFactRow,
  RequestEventRow,
  StyleSignalRow,
} from "../types";

export const ANCHOR_UNASKED_NOTE =
  "Ask preference_anchor, phrased around the concrete profile fact for these garments; do not reuse prior wording.";

export const ANCHOR_KEEP_ASSUMPTION =
  "Kept it in your usual lane — say the word for something new.";

const THE_USUAL_OPTION = {
  id: "the_usual",
  label: "The usual",
  preselected: true as const,
};

/** Garment-family tokens appearing in free text (signals, context, values). */
const GARMENT_FAMILY_RE =
  /\b(shirts?|tops?|blouses?|oxfords?|trousers?|pants?|jeans?|chinos?|shoes?|boots?|sneakers?|loafers?|blazers?|jackets?|coats?|dresses?|skirts?|sweaters?|hoodies?|suits?|ties?|belts?|swim(?:wear|suit)?s?|bikinis?|shorts?)\b/gi;

function familyKeysFromText(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(GARMENT_FAMILY_RE)) {
    const key = garmentSlotFamilyKey(m[0]!);
    if (key) out.add(key);
  }
  return out;
}

function briefGarmentKeys(garments: string[]): Set<string> {
  const out = new Set<string>();
  for (const g of garments) {
    const key = garmentSlotFamilyKey(g);
    if (key) out.add(key);
    for (const k of familyKeysFromText(g)) out.add(k);
  }
  return out;
}

function setsOverlap(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) {
    if (b.has(x)) return true;
  }
  return false;
}

/**
 * True when profile knowledge overlaps the brief's garments (signal, fit,
 * brand tied to those families, or a recent pick in that family).
 */
export function profileHasRelevantAnchorSignal(params: {
  garments: string[];
  signals: StyleSignalRow[];
  facts?: FashionFactRow[];
  recentEvents?: RequestEventRow[];
}): boolean {
  const briefKeys = briefGarmentKeys(params.garments);
  if (!briefKeys.size) return false;

  for (const signal of params.signals) {
    if (signal.signal_type === "shopping_style") continue;
    const hay = `${signal.signal_type} ${signal.context} ${signal.value}`;
    const keys = familyKeysFromText(hay);
    if (keys.size && setsOverlap(keys, briefKeys)) return true;
  }

  for (const signal of params.signals) {
    if (signal.signal_type !== "shopping_style") continue;
    if (/quick/i.test(signal.value) && briefKeys.size) return true;
  }

  for (const event of params.recentEvents ?? []) {
    const garment = event.attributes.garment?.trim();
    if (!garment) continue;
    const keys = familyKeysFromText(garment);
    if (keys.size && setsOverlap(keys, briefKeys)) return true;
  }

  // Aesthetic signals (navy, tailored, …) with no garment token still mean
  // the client has a lane — ask anchor whenever the brief has pieces.
  // Signals that name garment families only count via the overlap path above
  // (shirt history is not a lane for swimwear).
  const aesthetic = params.signals.some((s) => {
    if (s.signal_type === "shopping_style") return false;
    if ((s.polarity ?? 0) <= 0) return false;
    if (!s.value.trim()) return false;
    const keys = familyKeysFromText(
      `${s.signal_type} ${s.context} ${s.value}`,
    );
    return keys.size === 0;
  });
  if (aesthetic && briefKeys.size) return true;

  // Any recent pick implies a known lane for this appointment.
  if ((params.recentEvents ?? []).length > 0 && briefKeys.size) return true;
  if (
    briefKeys.size &&
    params.signals.some(
      (s) =>
        s.signal_type === "garment" &&
        /recent/i.test(s.context ?? "") &&
        s.value.trim().length > 0,
    )
  ) {
    return true;
  }

  return false;
}

export function parsePreferenceAnchorFromWords(
  text: string | undefined,
): "keep" | "push" | "explore" | null {
  if (!text?.trim()) return null;
  const t = text.toLowerCase();
  // Push / explore before "keep it …" — "keep it smart casual" is formality,
  // not preference_anchor keep, and often co-occurs with "push me a little".
  if (/\b(push me|a little different|nudge)\b/i.test(t)) return "push";
  if (
    /\b(something new|something different|surprise me|try something else|mix it up)\b/i.test(
      t,
    ) ||
    /نغي[ّّ]?ر|شي جديد|شيء جديد/.test(t)
  ) {
    return "explore";
  }
  // "Keep it simple/casual/…" is depth/style, not preference_anchor keep.
  if (/\bkeep it\s+\w+/i.test(t)) return null;
  if (
    /\b(the usual|same as (last|usual|always)|my usual|stick with( the usual)?|same lane)\b/i.test(
      t,
    )
  ) {
    return "keep";
  }
  // Escape / speed is NOT keep — caller leaves preference_anchor unspecified
  // with ANCHOR_KEEP_ASSUMPTION spoken.
  return null;
}

export function isSameGarmentRefinement(params: {
  brief: FashionSearchBrief;
  lastBriefGarments?: string[] | null;
  lastAssistantWasCuration: boolean;
}): boolean {
  if (!params.lastAssistantWasCuration) return false;
  if (!params.lastBriefGarments?.length) return false;
  return (
    garmentsKey(params.brief.garments) === garmentsKey(params.lastBriefGarments)
  );
}

/** Prefer recent_picks / request events; fall back to garment signals. */
export function pickHintFromProfile(params: {
  signals: Array<{
    signal_type: string;
    value: string;
    context?: string | null;
  }>;
  recentEvents?: RequestEventRow[];
}): string | null {
  const fromEvents = (params.recentEvents ?? [])
    .map((e) => {
      const g = e.attributes.garment?.trim();
      const brand = e.attributes.brand?.trim();
      const color = e.attributes.color?.trim();
      if (!g) return null;
      const label = [color, brand].filter(Boolean).join(" ");
      return label || g;
    })
    .find(Boolean);
  if (fromEvents) return fromEvents;

  const recent = params.signals.find(
    (s) =>
      s.signal_type === "garment" &&
      /recent/i.test(s.context ?? "") &&
      s.value.trim().length > 0,
  );
  if (recent) return recent.value.trim();

  const anyGarment = params.signals.find(
    (s) => s.signal_type === "garment" && s.value.trim().length > 0,
  );
  return anyGarment?.value.trim() ?? null;
}

export function buildPreferenceAnchorQuestion(params: {
  referent?: string | null;
}): FashionClarificationQuestion {
  const referent = params.referent?.trim();
  return {
    text: referent
      ? `Last time you took ${referent} — same lane?`
      : "The usual, or something new?",
    gap: "preference_anchor",
    kind: "consult",
    why: referent ? referent.slice(0, 48) : "You have a lane here",
    quick_options: [
      THE_USUAL_OPTION,
      "Push me a little",
      "Something new",
    ],
  };
}

export type AnchorGateDecision =
  | { action: "pass" }
  | { action: "ask"; question: FashionClarificationQuestion }
  | {
      action: "force_keep";
      brief: FashionSearchBrief;
      assumption: string;
    };

export function decideAnchorGate(params: {
  brief: FashionSearchBrief;
  signals: StyleSignalRow[];
  facts?: FashionFactRow[];
  recentEvents?: RequestEventRow[];
  lastUserMessage?: string;
  lastAssistantWasCuration?: boolean;
  lastBriefGarments?: string[] | null;
  /** True when we already ran one ANCHOR UNASKED retry this turn. */
  alreadyRetried?: boolean;
  /** True when preference_anchor was already asked earlier in the thread. */
  preferenceAnchorAsked?: boolean;
}): AnchorGateDecision {
  const fromWords = parsePreferenceAnchorFromWords(params.lastUserMessage);
  if (fromWords) {
    return { action: "pass" };
  }

  if (
    isSameGarmentRefinement({
      brief: params.brief,
      lastBriefGarments: params.lastBriefGarments,
      lastAssistantWasCuration: Boolean(params.lastAssistantWasCuration),
    })
  ) {
    return { action: "pass" };
  }

  const known = profileHasRelevantAnchorSignal({
    garments: params.brief.garments,
    signals: params.signals,
    facts: params.facts,
    recentEvents: params.recentEvents,
  });
  if (!known) return { action: "pass" };

  // Known + overlapping: must ASK — LLM inventing keep/push/explore is silent.
  if (!params.preferenceAnchorAsked) {
    if (params.alreadyRetried) {
      const assumptions = [...(params.brief.assumptions ?? [])];
      if (!assumptions.includes(ANCHOR_KEEP_ASSUMPTION)) {
        assumptions.push(ANCHOR_KEEP_ASSUMPTION);
      }
      // Escape / timeout: never hard-set keep — leave unspecified + speech.
      return {
        action: "force_keep",
        brief: {
          ...params.brief,
          preference_anchor: "unspecified",
          assumptions,
        },
        assumption: ANCHOR_KEEP_ASSUMPTION,
      };
    }
    const pickHint = pickHintFromProfile({
      signals: params.signals,
      recentEvents: params.recentEvents,
    });

    return {
      action: "ask",
      question: buildPreferenceAnchorQuestion({ referent: pickHint }),
    };
  }

  const anchor = params.brief.preference_anchor ?? "unspecified";
  if (anchor !== "unspecified") return { action: "pass" };

  // Already asked this thread — don't loop; leave unspecified + speech.
  if (params.preferenceAnchorAsked || params.alreadyRetried) {
    const assumptions = [...(params.brief.assumptions ?? [])];
    if (!assumptions.includes(ANCHOR_KEEP_ASSUMPTION)) {
      assumptions.push(ANCHOR_KEEP_ASSUMPTION);
    }
    return {
      action: "force_keep",
      brief: {
        ...params.brief,
        preference_anchor: "unspecified",
        assumptions,
      },
      assumption: ANCHOR_KEEP_ASSUMPTION,
    };
  }

  const pickHint = pickHintFromProfile({
    signals: params.signals,
    recentEvents: params.recentEvents,
  });

  return {
    action: "ask",
    question: buildPreferenceAnchorQuestion({ referent: pickHint }),
  };
}
