export type FittingStep =
  | "name"
  | "spend"
  | "photo"
  | "worn"
  | "wanted"
  | "nolist"
  | "honesty"
  | "verdict";

export const FITTING_STEPS: FittingStep[] = [
  "name",
  "spend",
  "photo",
  "worn",
  "wanted",
  "nolist",
  "honesty",
  "verdict",
];

/** Question steps only (excludes verdict). */
export const FITTING_Q_STEPS: Exclude<FittingStep, "verdict">[] = [
  "name",
  "spend",
  "photo",
  "worn",
  "wanted",
  "nolist",
  "honesty",
];

export const STITCH_KNOTS = [
  { id: "name", label: "Name", top: "3%" },
  { id: "era", label: "Era", top: "16%" },
  { id: "spend", label: "Spend", top: "29%" },
  { id: "photo", label: "Photo", top: "42%" },
  { id: "worn", label: "Worn", top: "55%" },
  { id: "wanted", label: "Wanted", top: "68%" },
  { id: "nolist", label: "No-list", top: "81%" },
  { id: "mint", label: "The mint", top: "96%", emphasis: true },
] as const;

/** sewn % per knot index */
export const SEWN_PCT = [3, 16, 29, 42, 55, 68, 81, 100];

/** progress bar % per question step 1–7 */
export const STEP_PROGRESS_PCT = [7, 19, 31, 43, 56, 70, 84];

export const STEP_META: Record<
  Exclude<FittingStep, "verdict">,
  {
    n: number;
    stage: string;
    /** Loading-screen headline while leaving this step. */
    flashCover: string;
    /** Loading status (red line) — “next up...” */
    flashNext: string;
    /** What work is happening on lock-in. */
    loadingDetail: string;
  }
> = {
  name: {
    n: 1,
    stage: "Getting to know you",
    flashCover: "Money stuff...<br><em>quick and painless.</em>",
    flashNext: "next up... how you spend",
    loadingDetail: "Saving your name and era…",
  },
  spend: {
    n: 2,
    stage: "Getting to know you",
    flashCover: "Best for last?<br>No... <em>best in the middle.</em>",
    flashNext: "next up... your photo",
    loadingDetail: "Saving how you like to spend…",
  },
  photo: {
    n: 3,
    stage: "Getting to know you",
    flashCover: "Now the real you...<br><em>hoodie included.</em>",
    flashNext: "next up... what you actually wore",
    loadingDetail: "Saving fit stats… starting your twin if a photo is ready…",
  },
  worn: {
    n: 4,
    stage: "Getting to know you",
    flashCover: "Okay, now<br><em>dream a little.</em>",
    flashNext: "next up... the closet you would steal",
    loadingDetail: "Saving what you actually wore… loading your dream set…",
  },
  wanted: {
    n: 5,
    stage: "Getting to know you",
    flashCover: "And the stuff<br>I <em>never</em> show you.",
    flashNext: "next up... your no-list",
    loadingDetail: "Saving your steal list…",
  },
  nolist: {
    n: 6,
    stage: "Getting to know you",
    flashCover: "Last one...<br><em>it is a good one.</em>",
    flashNext: "next up... how honest you want me",
    loadingDetail: "Saving brands and vetoes…",
  },
  honesty: {
    n: 7,
    stage: "Getting to know you",
    flashCover: "Say hello<br>to <em>you.</em>",
    flashNext: "next up... your card",
    loadingDetail: "Locking taste and honesty… building your verdict…",
  },
};

/** Knot index highlighted / sewn for each step */
export function knotNowIndex(step: FittingStep): number {
  switch (step) {
    case "name":
      return 0;
    case "spend":
      return 2;
    case "photo":
      return 3;
    case "worn":
      return 4;
    case "wanted":
      return 5;
    case "nolist":
      return 6;
    case "honesty":
    case "verdict":
      return 7;
    default:
      return 0;
  }
}

export function sewnThroughIndex(step: FittingStep): number {
  switch (step) {
    case "name":
      return -1;
    case "spend":
      return 0;
    case "photo":
      return 2;
    case "worn":
      return 3;
    case "wanted":
      return 4;
    case "nolist":
      return 5;
    case "honesty":
      return 6;
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
  photoUrl: string | null;
  /** Real FASHN twin face/url when minted; face photo falls back to photoUrl. */
  twinAvatarUrl: string | null;
  heightCm: number | null;
  build: BuildKey | null;
  /** Soft / toned / defined — drives mock twin musculature. */
  muscularity: "low" | "moderate" | "high" | null;
  /** Proportion distribution for mock twin path. */
  bodyShape:
    | "rectangle"
    | "triangle"
    | "inverted_triangle"
    | "hourglass"
    | "oval"
    | null;
  /** Feminine bust band for mock twin (null when not applicable). */
  bustFullness: "subtle" | "average" | "full" | "very_full" | null;
  form: SilhouetteForm;
  developPct: number;
  twinStatus: "idle" | "developing" | "ready" | "error";
  twinError: string | null;
  /** FASHN full-look of a worn style on the twin (verdict step). */
  dressStatus: "idle" | "dressing" | "ready" | "error";
  dressError: string | null;
  dressStyleLabel: string | null;
  /** Product image URLs for closet slots (from worn picks). */
  closetImages: string[];
  serial: string;
  foil: boolean;
};

export const EMPTY_MIRROR: MirrorState = {
  name: "",
  eraLabel: "",
  spendLabel: "",
  leanLabel: "",
  brandsLabel: "",
  noListLabel: "",
  photoUrl: null,
  twinAvatarUrl: null,
  heightCm: null,
  build: null,
  muscularity: null,
  bodyShape: null,
  bustFullness: null,
  form: "n",
  developPct: 4,
  twinStatus: "idle",
  twinError: null,
  dressStatus: "idle",
  dressError: null,
  dressStyleLabel: null,
  closetImages: [],
  serial: "——",
  foil: false,
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
