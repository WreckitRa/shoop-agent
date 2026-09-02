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
  | "verdict"
  | "circle";

export const FITTING_STEPS: FittingStep[] = [
  "consent",
  "photo",
  "fit",
  "name",
  "life",
  "spend",
  "worn",
  "corner",
  "nolist",
  "honesty",
  "verdict",
  "circle",
];

/** Scan → verify → verdict card → friends. Chat and chrome close. */
export function isMagicFittingStep(step: FittingStep): boolean {
  return step === "verdict" || step === "circle";
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
  if (args.step === "circle") {
    return { step: "verdict", finale: "card" };
  }
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
  "fit",
  "name",
  "life",
  "spend",
  "worn",
  "corner",
  "nolist",
  "honesty",
  "circle",
];

export const STITCH_KNOTS = [
  { id: "photo", label: "Photo", top: "3%" },
  { id: "fit", label: "Fit", top: "14%" },
  { id: "name", label: "Name", top: "25%" },
  { id: "life", label: "Life", top: "36%" },
  { id: "spend", label: "Spend", top: "47%" },
  { id: "worn", label: "Worn", top: "53%" },
  { id: "corner", label: "Corner", top: "63%" },
  { id: "nolist", label: "No-list", top: "73%" },
  { id: "mint", label: "The mint", top: "85%", emphasis: true },
  { id: "circle", label: "Circle", top: "96%" },
] as const;

/** Left-rail groups — same knots, sequential, mock tracker chrome. */
export const TRACKER_GROUPS = [
  { label: "LOOK", knotIds: ["photo", "fit", "name"] },
  { label: "LIFE", knotIds: ["life"] },
  { label: "EVIDENCE", knotIds: ["spend", "worn", "corner", "nolist"] },
  { label: "DIRECTION", knotIds: ["mint"] },
  { label: "PERSON", knotIds: ["circle"] },
] as const;

/** sewn % per knot index */
export const SEWN_PCT = [3, 13, 23, 33, 43, 53, 63, 73, 85, 100];

/** progress bar % per question step */
export const STEP_PROGRESS_PCT = [3, 11, 20, 28, 36, 44, 52, 61, 70, 81, 93];

export const STEP_META: Record<
  Exclude<FittingStep, "verdict">,
  {
    n: number;
    stage: string;
  }
> = {
  consent: { n: 1, stage: "Before we start" },
  photo: { n: 2, stage: "Getting to know you" },
  fit: { n: 3, stage: "Getting to know you" },
  name: { n: 4, stage: "Getting to know you" },
  life: { n: 5, stage: "Getting to know you" },
  spend: { n: 6, stage: "Getting to know you" },
  worn: { n: 7, stage: "Getting to know you" },
  corner: { n: 8, stage: "Getting to know you" },
  nolist: { n: 9, stage: "Getting to know you" },
  honesty: { n: 10, stage: "Getting to know you" },
  circle: { n: 11, stage: "Getting to know you" },
};

/** Knot index highlighted / sewn for each step */
export function knotNowIndex(step: FittingStep): number {
  switch (step) {
    case "consent":
    case "photo":
      return 0;
    case "fit":
      return 1;
    case "name":
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
    case "circle":
      return 9;
    default:
      return 0;
  }
}

export function sewnThroughIndex(step: FittingStep): number {
  switch (step) {
    case "consent":
    case "photo":
      return -1;
    case "fit":
      return 0;
    case "name":
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
    case "circle":
      return 8;
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
  circleLabel: string;
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
  circleLabel: "",
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
  if (label.includes("First-paycheck") || label.includes("23"))
    return "FIRST-PAYCHECK";
  if (label.includes("30") || label.includes("Prime")) return "PRIME";
  if (label.includes("40") || label.includes("Power")) return "POWER";
  if (label.includes("Refine") || label.includes("50")) return "REFINED";
  if (label.includes("Icon") || label.includes("65")) return "ICON";
  if (label.includes("Campus") || label.includes("18")) return "CAMPUS";
  if (label.includes("High-school") || label.includes("15")) return "SCHOOL";
  if (label.includes("Figuring") || label.includes("13")) return "STARTING";
  return label.toUpperCase().slice(0, 12);
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

/** Format trusted-circle names for the Mirror print line. */
export function circleMirrorLabel(names: string[]): string {
  const cleaned = names.map((n) => n.trim()).filter(Boolean);
  if (!cleaned.length) return "";
  if (cleaned.length === 1) return cleaned[0]!;
  if (cleaned.length === 2) return `${cleaned[0]}, ${cleaned[1]}`;
  return `${cleaned[0]}, ${cleaned[1]} +${cleaned.length - 2}`;
}

export function printSerialFromId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const n = (h % 900000) + 1;
  return String(n).padStart(6, "0");
}
