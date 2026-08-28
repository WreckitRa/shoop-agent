export type FittingStep =
  | "consent"
  | "photo"
  | "name"
  | "life"
  | "spend"
  | "fit"
  | "worn"
  | "wanted"
  | "nolist"
  | "honesty"
  | "circle"
  | "verdict";

export const FITTING_STEPS: FittingStep[] = [
  "consent",
  "photo",
  "name",
  "life",
  "spend",
  "fit",
  "worn",
  "wanted",
  "nolist",
  "honesty",
  "circle",
  "verdict",
];

/** Question steps only (excludes verdict). */
export const FITTING_Q_STEPS: Exclude<FittingStep, "verdict">[] = [
  "consent",
  "photo",
  "name",
  "life",
  "spend",
  "fit",
  "worn",
  "wanted",
  "nolist",
  "honesty",
  "circle",
];

export const STITCH_KNOTS = [
  { id: "photo", label: "Photo", top: "3%" },
  { id: "name", label: "Name", top: "13%" },
  { id: "life", label: "Life", top: "23%" },
  { id: "spend", label: "Spend", top: "33%" },
  { id: "fit", label: "Fit", top: "43%" },
  { id: "worn", label: "Worn", top: "53%" },
  { id: "wanted", label: "Wanted", top: "63%" },
  { id: "nolist", label: "No-list", top: "73%" },
  { id: "circle", label: "Circle", top: "84%" },
  { id: "mint", label: "The mint", top: "96%", emphasis: true },
] as const;

/** Left-rail groups — same knots, sequential, mock tracker chrome. */
export const TRACKER_GROUPS = [
  { label: "LOOK", knotIds: ["photo", "name"] },
  { label: "LIFE", knotIds: ["life"] },
  { label: "EVIDENCE", knotIds: ["spend", "fit", "worn", "wanted", "nolist"] },
  { label: "PERSON", knotIds: ["circle"] },
  { label: "DIRECTION", knotIds: ["mint"] },
] as const;

/** sewn % per knot index */
export const SEWN_PCT = [3, 13, 23, 33, 43, 53, 63, 73, 84, 100];

/** progress bar % per question step */
export const STEP_PROGRESS_PCT = [3, 10, 18, 26, 34, 44, 54, 64, 74, 84, 93];

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
  life: { n: 4, stage: "Getting to know you" },
  spend: { n: 5, stage: "Getting to know you" },
  fit: { n: 6, stage: "Getting to know you" },
  worn: { n: 7, stage: "Getting to know you" },
  wanted: { n: 8, stage: "Getting to know you" },
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
    case "name":
      return 1;
    case "life":
      return 2;
    case "spend":
      return 3;
    case "fit":
      return 4;
    case "worn":
      return 5;
    case "wanted":
      return 6;
    case "nolist":
      return 7;
    case "honesty":
    case "circle":
      return 8;
    case "verdict":
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
    case "name":
      return 0;
    case "life":
      return 1;
    case "spend":
      return 2;
    case "fit":
      return 3;
    case "worn":
      return 4;
    case "wanted":
      return 5;
    case "nolist":
      return 6;
    case "honesty":
      return 7;
    case "circle":
      return 8;
    case "verdict":
      return 9;
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
};

export const EMPTY_MIRROR: MirrorState = {
  name: "",
  eraLabel: "",
  spendLabel: "",
  leanLabel: "",
  brandsLabel: "",
  noListLabel: "",
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
};

export function formFromGender(gender: string): SilhouetteForm {
  const g = gender.toLowerCase();
  if (g === "masculine") return "m";
  if (g === "feminine") return "f";
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
