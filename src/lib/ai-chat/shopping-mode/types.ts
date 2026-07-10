/**
 * Shopping mode shapes how Shoop responds to a single user turn.
 *
 * - `judge`       → objective query: 1 lead pick + runner-up + wildcard + rule-out log
 * - `copilot`     → subjective query: 8–10 swipe-react curated items
 * - `hybrid`      → mixed / default fallback: lead pick + 2 alternatives with tradeoff labels
 * - `directional` → context/occasion query: 3–4 named directions × 2 hero pieces, cross-mix
 *
 * `auto` is a UX-level token from the client meaning "detect the right mode for me".
 * The server resolves it to one of the four real modes before building the prompt.
 */
export type ShoppingMode = "judge" | "copilot" | "hybrid" | "directional";

export type ShoppingModeSelection = ShoppingMode | "auto";

export type ShoppingModeSource = "user" | "auto";

/** Stored on the assistant message metadata so the UI can label each turn. */
export type ShoppingModeResolved = {
  mode: ShoppingMode;
  source: ShoppingModeSource;
  /** Short human-readable reason emitted by the detector (auto-only). */
  reason?: string;
  /** Detected context tag (Burning Man, ski trip, …) when applicable. */
  contextTag?: string | null;
};

export const SHOPPING_MODES: readonly ShoppingMode[] = [
  "judge",
  "copilot",
  "hybrid",
  "directional",
] as const;

export const SHOPPING_MODE_SELECTIONS: readonly ShoppingModeSelection[] = [
  "auto",
  "judge",
  "copilot",
  "hybrid",
  "directional",
] as const;

export function isShoppingMode(value: unknown): value is ShoppingMode {
  return typeof value === "string" && (SHOPPING_MODES as readonly string[]).includes(value);
}

export function isShoppingModeSelection(
  value: unknown,
): value is ShoppingModeSelection {
  return (
    typeof value === "string" &&
    (SHOPPING_MODE_SELECTIONS as readonly string[]).includes(value)
  );
}

export const SHOPPING_MODE_LABEL: Record<ShoppingModeSelection, string> = {
  auto: "Default mode",
  judge: "Pick one for me",
  copilot: "Give me smart options",
  hybrid: "Hybrid",
  directional: "Directional",
};

export const SHOPPING_MODE_HINT: Record<ShoppingModeSelection, string> = {
  auto: "Pick the best mode based on your message.",
  judge: "Best for clear, objective asks (\"AirPods Pro Max under $400\").",
  copilot: "Best when you're not sure yet — swipe through curated picks.",
  hybrid: "Lead pick + 2 alternatives. Good default for mixed asks.",
  directional: "Context/occasion (Burning Man, ski trip, wedding guest…).",
};
