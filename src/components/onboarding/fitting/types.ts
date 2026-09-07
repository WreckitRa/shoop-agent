export type FittingStep =
  | "consent"
  | "photo"
  | "fit"
  | "name"
  | "life"
  | "spend"
  | "worn"
  | "corner"
  | "nolist"
  | "honesty"
  | "verdict";

export const FITTING_STEPS: FittingStep[] = [
  "consent",
  "photo",
  "name",
  "fit",
  "life",
  "spend",
  "worn",
  "corner",
  "nolist",
  "honesty",
  "verdict",
];

/** Scan → verify → verdict card. Chat and chrome close. */
export function isMagicFittingStep(step: FittingStep): boolean {
  return step === "verdict";
}

/** Photo CTA sits under the copy until a face is on the twin. */
export function twinDocksInFlow(step: FittingStep, hasPhoto: boolean): boolean {
  return step === "photo" && !hasPhoto;
}

export type FittingBackFinale = "scan" | "card";

/** Where Back lands. Null = stay (consent, or scan before the card). */
export function fittingBackTarget(args: {
  step: FittingStep;
  finale?: FittingBackFinale;
  hasPhoto?: boolean;
}): { step: FittingStep; finale?: FittingBackFinale } | null {
  if (args.step === "verdict" && args.finale === "card" && args.hasPhoto) {
    return { step: "verdict", finale: "scan" };
  }
  if (isMagicFittingStep(args.step)) return null;
  const idx = FITTING_STEPS.indexOf(args.step);
  if (idx <= 0) return null;
  return { step: FITTING_STEPS[idx - 1]! };
}
export const FITTING_Q_STEPS: Exclude<FittingStep, "verdict">[] = [
  "consent",
  "photo",
  "name",
  "fit",
  "life",
  "spend",
  "worn",
  "corner",
  "nolist",
  "honesty",
];

export const STITCH_KNOTS = [
  { id: "photo", label: "Your photo", top: "3%" },
  { id: "name", label: "Name", top: "14%" },
  { id: "fit", label: "Fit", top: "25%" },
  { id: "life", label: "Life", top: "36%" },
  { id: "spend", label: "Spend", top: "47%" },
  { id: "worn", label: "Worn", top: "53%" },
  { id: "corner", label: "What you'd change", top: "63%" },
  { id: "nolist", label: "Never again", top: "73%" },
  { id: "mint", label: "Your reading", top: "96%", emphasis: true },
] as const;

/** Left-rail groups — same knots, sequential, mock tracker chrome. */
export const TRACKER_GROUPS = [
  { label: "LOOK", knotIds: ["photo", "name", "fit"] },
  { label: "LIFE", knotIds: ["life"] },
  { label: "EVIDENCE", knotIds: ["spend", "worn", "corner", "nolist"] },
  { label: "DIRECTION", knotIds: ["mint"] },
] as const;

/** sewn % per knot index */
export const SEWN_PCT = [3, 13, 23, 33, 43, 53, 63, 73, 100];

/** progress bar % per question step */
export const STEP_PROGRESS_PCT = [3, 11, 20, 28, 36, 44, 52, 61, 70, 81];

export const STEP_META: Record<
  Exclude<FittingStep, "verdict">,
  {
    n: number;
    stage: string;
  }
> = {
  consent: { n: 1, stage: "Before we start" },
  photo: { n: 2, stage: "Getting to know you" },
  name: { n: 3, stage: "Getting to know you" },
  fit: { n: 4, stage: "Getting to know you" },
  life: { n: 5, stage: "Getting to know you" },
  spend: { n: 6, stage: "Getting to know you" },
  worn: { n: 7, stage: "Getting to know you" },
  corner: { n: 8, stage: "Getting to know you" },
  nolist: { n: 9, stage: "Getting to know you" },
  honesty: { n: 10, stage: "Getting to know you" },
};

/** Knot index highlighted / sewn for each step */
export function knotNowIndex(step: FittingStep): number {
  switch (step) {
    case "consent":
    case "photo":
      return 0;
    case "name":
      return 1;
    case "fit":
      return 2;
    case "life":
      return 3;
    case "spend":
      return 4;
    case "worn":
      return 5;
    case "corner":
      return 6;
    case "nolist":
      return 7;
    case "honesty":
    case "verdict":
      return 8;
    default:
      return 0;
  }
}

export function sewnThroughIndex(step: FittingStep): number {
  switch (step) {
    case "consent":
    case "photo":
      return -1;
    case "name":
      return 0;
    case "fit":
      return 1;
    case "life":
      return 2;
    case "spend":
      return 3;
    case "worn":
      return 4;
    case "corner":
      return 5;
    case "nolist":
      return 6;
    case "honesty":
    case "verdict":
      return 7;
    default:
      return -1;
  }
}

export type SilhouetteForm = "n" | "m" | "f";
export type BuildKey = "slim" | "average" | "athletic" | "broad" | "plus";

export type MirrorState = {
  name: string;
  eraLabel: string;
  spendLabel: string;
  leanLabel: string;
  brandsLabel: string;
  noListLabel: string;
  cornerLabel: string;
  /** Face photo — silhouette head only until the twin is ready. */
  photoUrl: string | null;
  /** FASHN twin (or dressed twin) — full-card fill when twinStatus is ready. */
  twinAvatarUrl: string | null;
  heightCm: number | null;
  build: BuildKey | null;
  /** Soft / toned / defined — drives silhouette musculature. */
  muscularity: "low" | "moderate" | "high" | null;
  /** Proportion distribution for the silhouette path. */
  bodyShape:
    | "rectangle"
    | "triangle"
    | "inverted_triangle"
    | "hourglass"
    | "oval"
    | null;
  /** Feminine bust band for the silhouette (null when not applicable). */
  bustFullness: "subtle" | "average" | "full" | "very_full" | null;
  /** Rise vs inseam — visual split only. */
  legLine: "long_torso" | "even" | "long_leg" | null;
  form: SilhouetteForm;
  developPct: number;
  twinStatus: "idle" | "developing" | "ready" | "error";
  twinError: string | null;
  /** 0–100 while minting — card overlay, not quiz progress. */
  twinBuildPct: number;
  twinBuildLabel: string;
  /** Elapsed seconds while minting — ticking clock so the card never looks frozen. */
  twinBuildElapsedSec: number;
  /** FASHN full-look of a worn style on the twin (verdict step). */
  dressStatus: "idle" | "dressing" | "ready" | "error";
  dressError: string | null;
  dressStyleLabel: string | null;
  /** Product image URLs for closet slots (from worn picks). */
  closetImages: string[];
  serial: string;
  foil: boolean;
  /** Photo analysis / verdict writing — visual lives on this card, not a second photo. */
  scanActivity: "idle" | "reading" | "review" | "writing";
  scanNotes: Array<{ label: string; value: string }>;
  /** Worn-grid picks — tracker facts, not the collapsed lean mix. */
  wornLabels: string[];
};

export const EMPTY_MIRROR: MirrorState = {
  name: "",
  eraLabel: "",
  spendLabel: "",
  leanLabel: "",
  brandsLabel: "",
  noListLabel: "",
  cornerLabel: "",
  photoUrl: null,
  twinAvatarUrl: null,
  heightCm: null,
  build: null,
  muscularity: null,
  bodyShape: null,
  bustFullness: null,
  legLine: null,
  form: "n",
  developPct: 4,
  twinStatus: "idle",
  twinError: null,
  twinBuildPct: 0,
  twinBuildLabel: "",
  twinBuildElapsedSec: 0,
  dressStatus: "idle",
  dressError: null,
  dressStyleLabel: null,
  closetImages: [],
  serial: "——",
  foil: false,
  scanActivity: "idle",
  scanNotes: [],
  wornLabels: [],
};

export function formFromGender(gender: string): SilhouetteForm {
  const g = gender.toLowerCase();
  if (g === "masculine" || g === "menswear" || g === "mens") return "m";
  if (g === "feminine" || g === "womenswear" || g === "womens") return "f";
  return "n";
}

export function shortEraLabel(label: string): string {
  const lower = label.toLowerCase();
  if (
    lower.includes("first-paycheck") ||
    lower.includes("first paycheck") ||
    lower === "23_29" ||
    lower.includes("23–29") ||
    lower.includes("23-29")
  ) {
    return "First paycheck";
  }
  if (lower.includes("prime") || lower === "30s") return "Prime";
  if (lower.includes("power") || lower === "40s") return "Power";
  if (lower.includes("refine") || lower.includes("50")) return "Refined";
  if (lower.includes("icon") || lower.includes("65")) return "Icon";
  if (lower.includes("campus") || lower.includes("18")) return "Campus";
  if (lower.includes("high-school") || lower.includes("15")) return "School";
  if (lower.includes("figuring") || lower.includes("13")) return "Starting";
  const cleaned = label.replace(/^[\d–\-+\s·]+/, "").trim();
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1, 22) : label;
}

export function spendShort(value: string): string {
  switch (value) {
    case "best_value":
      return "Smart";
    case "premium":
      return "Quality";
    case "luxury":
      return "Luxe";
    case "deal_hunter":
      return "Deals";
    case "design_first":
      return "Design";
    default:
      return value.slice(0, 10);
  }
}

/** Unique worn-grid labels for the tracker, in pick order. */
export function wornTrackerLabels(labels: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of labels) {
    const text = raw.trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

export function printSerialFromId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const n = (h % 900000) + 1;
  return String(n).padStart(6, "0");
}
