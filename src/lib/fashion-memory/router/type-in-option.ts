import { CLARIFICATION_OTHER_OPTION_ID } from "./clarification-defaults";
import { YOU_DECIDE_OPTION_ID } from "./consultation";
import type { FashionClarificationAnswer } from "./types";

export const CUSTOM_OPTION_PREFIX = "c:";
const MAX_CUSTOM_LABELS = 8;
const MAX_CUSTOM_LABEL_LEN = 80;

export function customOptionId(label: string): string {
  return `${CUSTOM_OPTION_PREFIX}${label}`;
}

export function isCustomOptionId(id: string): boolean {
  return id.startsWith(CUSTOM_OPTION_PREFIX);
}

export function labelFromCustomOptionId(id: string): string {
  return id.slice(CUSTOM_OPTION_PREFIX.length);
}

export function normalizeTypedOption(text: string): string {
  return text.trim().replace(/\s+/g, " ").slice(0, MAX_CUSTOM_LABEL_LEN);
}

export type TypeInState = {
  selected: string[];
  customLabels: string[];
};

function withoutMeta(ids: string[]): string[] {
  return ids.filter(
    (id) => id !== CLARIFICATION_OTHER_OPTION_ID && id !== YOU_DECIDE_OPTION_ID,
  );
}

/** Commit typed text as a selected chip. Does not toggle off if already on. */
export function applyTypedOption(
  state: TypeInState,
  text: string,
  known: Array<{ id: string; label: string }>,
  multi: boolean,
): TypeInState {
  const trimmed = normalizeTypedOption(text);
  if (!trimmed) return state;

  const knownHit = known.find(
    (o) =>
      o.id !== CLARIFICATION_OTHER_OPTION_ID &&
      (o.label.toLowerCase() === trimmed.toLowerCase() ||
        o.id.toLowerCase() === trimmed.toLowerCase()),
  );
  if (knownHit) {
    return selectId(state, knownHit.id, multi);
  }

  const existing = state.customLabels.find(
    (l) => l.toLowerCase() === trimmed.toLowerCase(),
  );
  if (!existing && state.customLabels.length >= MAX_CUSTOM_LABELS) {
    return state;
  }
  const label = existing ?? trimmed;
  const customLabels = existing
    ? state.customLabels
    : [...state.customLabels, label];
  return selectId({ ...state, customLabels }, customOptionId(label), multi);
}

function selectId(state: TypeInState, id: string, multi: boolean): TypeInState {
  const current = withoutMeta(state.selected);
  if (multi) {
    if (current.includes(id)) return { ...state, selected: current };
    return { ...state, selected: [...current, id] };
  }
  return { ...state, selected: [id] };
}

export function answerFromTypeIn(
  selected: string[],
): FashionClarificationAnswer | null {
  const customs = selected
    .filter(isCustomOptionId)
    .map(labelFromCustomOptionId)
    .filter(Boolean);
  const chipIds = selected.filter(
    (id) =>
      id !== CLARIFICATION_OTHER_OPTION_ID && !isCustomOptionId(id),
  );
  if (customs.length) return { selected: chipIds, customText: customs.join(", ") };
  if (!chipIds.length) return null;
  return { selected: chipIds };
}
