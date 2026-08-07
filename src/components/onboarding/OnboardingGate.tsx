"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FittingFlash } from "@/components/onboarding/fitting/FittingFlash";
import {
  FittingPhotoStep,
  defaultMuscularityForBuild,
  type FittingPhotoValues,
} from "@/components/onboarding/fitting/FittingPhotoStep";
import { FittingShell } from "@/components/onboarding/fitting/FittingShell";
import { FittingVerdictStep } from "@/components/onboarding/fitting/FittingVerdictStep";
import {
  EMPTY_MIRROR,
  FITTING_Q_STEPS,
  FITTING_STEPS,
  STEP_META,
  STEP_PROGRESS_PCT,
  formFromGender,
  shortEraLabel,
  spendShort,
  type BuildKey,
  type FittingStep,
  type MirrorState,
} from "@/components/onboarding/fitting/types";
import { TasteHonestyStep } from "@/components/onboarding/TasteHonestyStep";
import { TasteLovesVetoesStep } from "@/components/onboarding/TasteLovesVetoesStep";
import {
  TasteOutfitGridStep,
  type OutfitGridCard,
} from "@/components/onboarding/TasteOutfitGridStep";
import { TasteSpendStep } from "@/components/onboarding/TasteSpendStep";
import {
  YouIdentityStep,
  type YouIdentityValues,
} from "@/components/onboarding/YouIdentityStep";
import {
  FittingBackLink,
  FittingCount,
} from "@/components/onboarding/onboarding-ui";
import { stubSerialFromId } from "@/components/onboarding/ShoopCard";
import { useSelfAvatarStore } from "@/components/tryon/self-avatar-store";
import { guestFetch } from "@/lib/client/guest-fetch";
import { useUserProfileStore } from "@/lib/client/user-profile-store";
import {
  BUDGET_OPTIONS,
  DEFAULT_CITY,
  DEFAULT_CURRENCY,
  DEFAULT_SHIPPING_COUNTRY,
  STYLE_ERAS,
  ageYearsFromBirthDate,
  currencyHintForCountry,
  isAtLeastAge,
  joinCsvValues,
  normalizeAgeRange,
  normalizeGender,
  parseCsvValues,
  styleEraLabel,
  styleEraToAgeRange,
} from "@/lib/onboarding/form-options";
import type { StyleMix } from "@/lib/onboarding/style-mix";
import {
  TRYON_CLIENT_POLL_MAX_MS,
  TRYON_CLIENT_POLL_MS,
} from "@/lib/tryon/client-poll";
import { isCompareSettled } from "@/lib/tryon/compare-variants";
import type {
  AvatarAttributes,
  AvatarCompareVariant,
  BuildBand,
  HeightBand,
} from "@/lib/tryon/types";

type AvatarApiBody = {
  error?: string;
  avatar?: { url?: string };
  draft?: {
    step?: string;
    preview_url?: string;
    compare?: boolean;
    compare_job_id?: string;
    preview_variants?: AvatarCompareVariant[];
    attributes?: AvatarAttributes;
    intake?: {
      refusal_message?: string;
      clear?: Partial<AvatarAttributes>;
    };
  };
};

async function readAvatarJson(res: Response): Promise<AvatarApiBody> {
  const text = await res.text();
  if (!text.trim()) {
    return {
      error: res.ok ? undefined : `Something went wrong (${res.status}).`,
    };
  }
  try {
    return JSON.parse(text) as AvatarApiBody;
  } catch {
    return { error: `Something went wrong (${res.status}).` };
  }
}

function birthDateToInput(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function heightBandFromCm(cm: number): HeightBand {
  if (cm < 160) return "under_160";
  if (cm < 170) return "160_170";
  if (cm < 180) return "170_180";
  if (cm < 190) return "180_190";
  return "over_190";
}

/** Full FASHN silhouette payload from photo-step answers (+ smart defaults). */
function buildFittingAvatarAttributes(opts: {
  heightCm: number;
  build: BuildBand;
  muscularity: FittingPhotoValues["muscularity"];
  bodyShape: FittingPhotoValues["bodyShape"];
  bustFullness: FittingPhotoValues["bustFullness"];
  includeBust: boolean;
}): AvatarAttributes {
  const attrs: AvatarAttributes = {
    height_band: heightBandFromCm(opts.heightCm),
    build: opts.build,
    muscularity:
      opts.muscularity ?? defaultMuscularityForBuild(opts.build),
  };
  if (opts.bodyShape) attrs.body_shape = opts.bodyShape;
  if (opts.includeBust && opts.bustFullness) {
    attrs.bust_fullness = opts.bustFullness;
  }
  return attrs;
}

function mergeLabelLists(a: string[], b: string[]): string[] {
  const map = new Map<string, string>();
  for (const raw of [...a, ...b]) {
    const t = raw.trim();
    if (!t) continue;
    map.set(t.toLowerCase(), t);
  }
  return [...map.values()];
}

function mergeCsvLabels(
  a: string | undefined,
  b: string | undefined,
): string | undefined {
  const list = mergeLabelLists(
    a?.split(",").map((s) => s.trim()).filter(Boolean) ?? [],
    b?.split(",").map((s) => s.trim()).filter(Boolean) ?? [],
  );
  return list.length ? list.join(", ") : undefined;
}

type OnboardingPrefill = {
  preferredName?: string;
  genderPresentation?: string;
  ageRange?: string;
  styleEras?: string;
  shippingCountry?: string;
  currency?: string;
  budgetPhilosophy?: string;
  brandLikes?: string;
  brandAvoids?: string;
  hardAvoids?: string;
  honestyPreference?: string;
  heightCm?: number;
  weightKg?: number;
  build?: string;
  muscularity?: string;
  bodyShape?: string;
  bustFullness?: string;
};

/** Accumulate free-text fills so later steps stay pre-populated after hydrates. */
function mergePrefillLatch(
  prev: OnboardingPrefill,
  next: OnboardingPrefill,
): OnboardingPrefill {
  return {
    preferredName: next.preferredName?.trim() || prev.preferredName,
    genderPresentation:
      next.genderPresentation?.trim() || prev.genderPresentation,
    ageRange: next.ageRange?.trim() || prev.ageRange,
    styleEras: mergeCsvLabels(prev.styleEras, next.styleEras) ?? prev.styleEras,
    shippingCountry: next.shippingCountry?.trim() || prev.shippingCountry,
    currency: next.currency?.trim() || prev.currency,
    budgetPhilosophy:
      mergeCsvLabels(prev.budgetPhilosophy, next.budgetPhilosophy) ??
      prev.budgetPhilosophy,
    brandLikes:
      mergeCsvLabels(prev.brandLikes, next.brandLikes) ?? prev.brandLikes,
    brandAvoids:
      mergeCsvLabels(prev.brandAvoids, next.brandAvoids) ?? prev.brandAvoids,
    hardAvoids:
      mergeCsvLabels(prev.hardAvoids, next.hardAvoids) ?? prev.hardAvoids,
    honestyPreference:
      next.honestyPreference?.trim() || prev.honestyPreference,
    heightCm: next.heightCm ?? prev.heightCm,
    weightKg: next.weightKg ?? prev.weightKg,
    build: next.build ?? prev.build,
    muscularity: next.muscularity ?? prev.muscularity,
    bodyShape: next.bodyShape ?? prev.bodyShape,
    bustFullness: next.bustFullness ?? prev.bustFullness,
  };
}

type OnboardingStatus = {
  prefill?: OnboardingPrefill;
  onboarding: {
    started: boolean;
    completed: boolean;
    missingRequiredFields: string[];
  };
  profile: {
    preferredName: string | null;
    ageRange: string | null;
    birthDate: string | Date | null;
    genderPresentation: string | null;
    country: string | null;
    city: string | null;
    currency: string | null;
    shippingCountry: string | null;
    valuePhilosophy: string | null;
    styleEra: string | null;
    honestyPreference: string | null;
    complimentPreferences: string[] | null;
    lifestyleTags: string[] | null;
    styleMix: StyleMix | null;
  } | null;
  sizing: {
    heightCm?: number | null;
    weightKg?: number | null;
    bodyType?: string | null;
    topUsualSize: string | null;
    bottomUsualSize: string | null;
    shoeEU: number | null;
    shoeUS: number | null;
  } | null;
  brandPreferences: Array<{ brand: string; sentiment: string }>;
  hardNegatives: Array<{ scope: string; value: string }>;
  tasteTags: Array<{ tag: string; polarity: string; category?: string | null }>;
};

const ONBOARDING_UI_SESSION_KEY = "shoop.onboarding.ui.v2";

type OnboardingUiSession = { step: FittingStep };

function isFittingStep(v: unknown): v is FittingStep {
  return typeof v === "string" && (FITTING_STEPS as string[]).includes(v);
}

function readOnboardingUiSession(): OnboardingUiSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(ONBOARDING_UI_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OnboardingUiSession>;
    if (!isFittingStep(parsed.step)) return null;
    return { step: parsed.step };
  } catch {
    return null;
  }
}

function writeOnboardingUiSession(pos: OnboardingUiSession) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(ONBOARDING_UI_SESSION_KEY, JSON.stringify(pos));
  } catch {
    /* ignore */
  }
}

function clearOnboardingUiSession() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(ONBOARDING_UI_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

function profileYouSaved(profile: OnboardingStatus["profile"]): boolean {
  if (!profile) return false;
  return Boolean(
    profile.preferredName?.trim() &&
      profile.genderPresentation?.trim() &&
      (profile.styleEra?.trim() || profile.ageRange?.trim()),
  );
}

function profileTasteSaved(status: OnboardingStatus): boolean {
  const p = status.profile;
  if (p?.styleMix) return true;
  if (p?.honestyPreference?.trim()) return true;
  if (
    status.tasteTags.some(
      (t) => t.category === "worn" || t.category === "aspirational",
    )
  ) {
    return true;
  }
  return false;
}

function resumeFloorFromStatus(status: OnboardingStatus): FittingStep {
  if (!status.onboarding.started) return "name";
  if (profileTasteSaved(status)) return "honesty";
  if (status.sizing?.heightCm || status.sizing?.bodyType) return "worn";
  if (status.profile?.valuePhilosophy) return "photo";
  if (profileYouSaved(status.profile)) return "spend";
  return "name";
}

function resolveResumeStep(status: OnboardingStatus): FittingStep {
  if (status.onboarding.completed) {
    clearOnboardingUiSession();
    return "name";
  }
  const floor = resumeFloorFromStatus(status);
  const session = readOnboardingUiSession();
  if (!session) return floor;
  const floorIdx = FITTING_STEPS.indexOf(floor);
  const sessionIdx = FITTING_STEPS.indexOf(session.step);
  if (sessionIdx < floorIdx) return floor;
  // Session may be mid-flow; never jump to verdict on reload
  if (session.step === "verdict") return "honesty";
  return session.step;
}

async function fetchSelfPerson(
  signal?: AbortSignal,
): Promise<{ id: string; hasAvatar: boolean; avatarUrl: string | null } | null> {
  try {
    const res = await fetch("/api/avatar/people", {
      cache: "no-store",
      signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      people?: Array<{
        id: string;
        relation: string;
        has_avatar?: boolean;
        avatar_url?: string | null;
      }>;
    };
    const self =
      json.people?.find((p) => p.relation === "self") ?? json.people?.[0];
    if (!self?.id) return null;
    return {
      id: self.id,
      hasAvatar: Boolean(self.has_avatar),
      avatarUrl: self.avatar_url ?? null,
    };
  } catch {
    return null;
  }
}

async function fetchStatus(
  signal?: AbortSignal,
): Promise<OnboardingStatus | "unauthorized"> {
  const res = await fetch("/api/onboarding", { cache: "no-store", signal });
  if (res.status === 401) return "unauthorized";
  if (!res.ok) throw new Error("load");
  return (await res.json()) as OnboardingStatus;
}

function togglePick(
  selected: OutfitGridCard[],
  card: OutfitGridCard,
  max: number,
): OutfitGridCard[] {
  const exists = selected.some((c) => c.id === card.id);
  if (exists) return selected.filter((c) => c.id !== card.id);
  if (selected.length >= max) return selected;
  return [...selected, card];
}

function heightCmFromPhoto(v: FittingPhotoValues): number {
  if (v.heightUnit === "cm") return v.heightCm;
  return Math.round((v.heightFt * 12 + v.heightIn) * 2.54);
}

function weightKgFromPhoto(v: FittingPhotoValues): number | null {
  if (v.weightSkipped || v.weightValue == null) return null;
  if (v.weightUnit === "kg") return Math.round(v.weightValue);
  return Math.round(v.weightValue * 0.453592);
}

function leanFromPicks(
  worn: OutfitGridCard[],
  stolen: OutfitGridCard[],
  styleMix: StyleMix | null,
): string {
  if (styleMix?.axes?.[0]?.label) {
    const label = styleMix.axes[0].label;
    return label.charAt(0).toUpperCase() + label.slice(1);
  }
  const scores: Record<string, number> = {
    Parisian: 0,
    Minimal: 0,
    Bold: 0,
  };
  const bump = (tags: string[] | undefined, w: number) => {
    for (const t of tags ?? []) {
      const low = t.toLowerCase();
      if (/paris|effortless|layered|quiet lux|chic/.test(low))
        scores.Parisian += w;
      else if (/minimal|clean|uniform|black|gallery/.test(low))
        scores.Minimal += w;
      else if (/bold|statement|color|power|loud/.test(low)) scores.Bold += w;
    }
  };
  for (const p of worn) bump(p.tasteTags ?? [p.archetype ?? p.label], 3);
  for (const p of stolen) bump(p.tasteTags ?? [p.archetype ?? p.label], 2);
  const top = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return top && top[1] > 0 ? top[0] : "";
}

/** Mirror % is only advanced by real persisted milestones. */
/**
 * Mirror “developing · %” — quiz progress toward a dressed twin.
 * Twin may mint early (after photo); that only advances the body band.
 * 100% is reserved for the final step (verdict / clothes on the avatar).
 */
function developPctFromFlags(flags: {
  identity: boolean;
  spend: boolean;
  sizing: boolean;
  photoAccepted: boolean;
  /** Body twin minted — not card-complete. */
  twinReady: boolean;
  wornSaved: boolean;
  wantedSaved: boolean;
  nolistSaved: boolean;
  tasteFinal: boolean;
  /** Final Fitting step. */
  verdict: boolean;
  /** FASHN try-on of a worn style onto the twin. */
  dressed: boolean;
}): number {
  let pct = 4;
  if (flags.identity) pct = 12;
  if (flags.spend) pct = Math.max(pct, 22);
  if (flags.sizing) pct = Math.max(pct, 32);
  if (flags.photoAccepted) pct = Math.max(pct, 40);
  // Early mint: body exists; keep room for taste + final dress.
  if (flags.twinReady) pct = Math.max(pct, 48);
  if (flags.wornSaved) pct = Math.max(pct, 58);
  if (flags.wantedSaved) pct = Math.max(pct, 68);
  if (flags.nolistSaved) pct = Math.max(pct, 78);
  if (flags.tasteFinal) pct = Math.max(pct, 88);
  // Verdict step landed — almost there until dress finishes.
  if (flags.verdict) pct = Math.max(pct, 94);
  // FASHN dressed twin from a worn style pick = true complete.
  if (flags.dressed) pct = Math.max(pct, 100);
  return pct;
}

export function OnboardingGate() {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<FittingStep>("name");
  const [selfPersonId, setSelfPersonId] = useState<string | null>(null);
  const [holdOpen, setHoldOpen] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [flash, setFlash] = useState<{
    cover: string;
    status: string;
    detail: string;
  } | null>(null);
  const [tellFeedback, setTellFeedback] = useState<string | null>(null);
  const [tellBusy, setTellBusy] = useState(false);
  /** Latched free-text fills so brands/vetoes/etc. survive until later steps. */
  const tellLatchRef = useRef<OnboardingPrefill>({});

  const submissionLockRef = useRef(false);
  const reviewRequestKeyRef = useRef<string | null>(null);
  const wornDeckInFlightRef = useRef(false);
  const aspirationalDeckInFlightRef = useRef(false);
  const wornPickLabelsRef = useRef<string[]>([]);
  const wornPickTasteTagsRef = useRef<string[]>([]);
  const avatarStartedRef = useRef(false);
  /** Server accepted photo draft (not just local preview). */
  const photoReadyRef = useRef(false);
  /** Prevent double FASHN spend. */
  const mintInFlightRef = useRef(false);
  const mintDoneRef = useRef(false);
  const mintAbortRef = useRef(false);

  const [preferredName, setPreferredName] = useState("");
  const [genderPresentation, setGenderPresentation] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [birthDateSkipped, setBirthDateSkipped] = useState(false);
  const [styleEras, setStyleEras] = useState<string[]>([]);
  const [lifestyleTags] = useState<string[]>([]);
  const detectedArea = useUserProfileStore((s) => s.detectedArea);
  const [city, setCity] = useState(DEFAULT_CITY);
  const [shippingCountry, setShippingCountry] = useState(
    DEFAULT_SHIPPING_COUNTRY,
  );
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);

  const [budgetPhilosophies, setBudgetPhilosophies] = useState<string[]>([]);
  const [customSpendLabels, setCustomSpendLabels] = useState<string[]>([]);
  const [wornDeck, setWornDeck] = useState<OutfitGridCard[]>([]);
  const [aspirationalDeck, setAspirationalDeck] = useState<OutfitGridCard[]>(
    [],
  );
  const [wornLoading, setWornLoading] = useState(false);
  const [aspirationalLoading, setAspirationalLoading] = useState(false);
  const [wornLoadingMore, setWornLoadingMore] = useState(false);
  const [aspirationalLoadingMore, setAspirationalLoadingMore] =
    useState(false);
  const [wornHasMore, setWornHasMore] = useState(false);
  const [aspirationalHasMore, setAspirationalHasMore] = useState(false);
  const [wornPicks, setWornPicks] = useState<OutfitGridCard[]>([]);
  const [aspirationalPicks, setAspirationalPicks] = useState<OutfitGridCard[]>(
    [],
  );
  /** Mirror closet slots — latched from worn picks so they survive deck reloads / hydration. */
  const [closetImages, setClosetImages] = useState<string[]>([]);
  const [brandLikes, setBrandLikes] = useState<string[]>([]);
  const [brandAvoids, setBrandAvoids] = useState<string[]>([]);
  const [hardAvoids, setHardAvoids] = useState<string[]>([]);
  const [honestyPreference, setHonestyPreference] = useState("");
  const [styleMix, setStyleMix] = useState<StyleMix | null>(null);

  const [photoValues, setPhotoValues] = useState<FittingPhotoValues>({
    photoPreview: null,
    heightUnit: "ft",
    heightFt: 5,
    heightIn: 9,
    heightCm: 175,
    weightValue: null,
    weightUnit: "lb",
    weightSkipped: false,
    build: null,
    muscularity: null,
    bodyShape: null,
    bustFullness: null,
  });
  /** Local face preview (object URL) while FASHN twin is generating. */
  const [localFacePreview, setLocalFacePreview] = useState<string | null>(null);
  /** Real mint result / people API avatar_url */
  const [twinAvatarUrl, setTwinAvatarUrl] = useState<string | null>(null);
  const [twinStatus, setTwinStatus] = useState<MirrorState["twinStatus"]>(
    "idle",
  );
  const [twinError, setTwinError] = useState<string | null>(null);
  /** FASHN dress of a worn style onto the twin (verdict step). */
  const [dressedAvatarUrl, setDressedAvatarUrl] = useState<string | null>(null);
  const [dressStatus, setDressStatus] = useState<
    "idle" | "dressing" | "ready" | "error"
  >("idle");
  const [dressError, setDressError] = useState<string | null>(null);
  const [dressStyleLabel, setDressStyleLabel] = useState<string | null>(null);
  const dressKickRef = useRef(false);
  const [persistedFlags, setPersistedFlags] = useState({
    identity: false,
    spend: false,
    sizing: false,
    wornSaved: false,
    wantedSaved: false,
    nolistSaved: false,
    tasteFinal: false,
  });

  useEffect(() => {
    wornPickLabelsRef.current = wornPicks.map((p) => p.label);
    wornPickTasteTagsRef.current = wornPicks.flatMap((p) => p.tasteTags ?? []);
    const urls = wornPicks
      .map((p) => p.imageUrl)
      .filter((u): u is string => Boolean(u?.trim()))
      .slice(0, 3);
    // Latch non-empty picks; don't wipe closet if picks are accidentally cleared.
    if (urls.length > 0) setClosetImages(urls);
  }, [wornPicks]);

  /** Only when identity context *content* changes — not new array refs from hydrate. */
  const outfitDeckContextKey = [
    genderPresentation.trim().toLowerCase(),
    joinCsvValues(styleEras),
    joinCsvValues(budgetPhilosophies),
  ].join("|");

  useEffect(() => {
    setWornDeck([]);
    setAspirationalDeck([]);
    setWornPicks([]);
    setAspirationalPicks([]);
    setClosetImages([]);
    wornDeckInFlightRef.current = false;
    aspirationalDeckInFlightRef.current = false;
  }, [outfitDeckContextKey]);

  const applyPrefill = useCallback((prefill: OnboardingPrefill) => {
    if (prefill.preferredName) setPreferredName(prefill.preferredName);
    if (prefill.genderPresentation) {
      setGenderPresentation(normalizeGender(prefill.genderPresentation));
    }
    if (prefill.styleEras) {
      setStyleEras((prev) =>
        mergeLabelLists(prev, parseCsvValues(prefill.styleEras)),
      );
    }
    if (prefill.budgetPhilosophy) {
      setBudgetPhilosophies((prev) =>
        mergeLabelLists(prev, parseCsvValues(prefill.budgetPhilosophy)),
      );
    }
    if (prefill.brandLikes) {
      setBrandLikes((prev) =>
        mergeLabelLists(
          prev,
          prefill.brandLikes!
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
        ),
      );
    }
    if (prefill.brandAvoids) {
      setBrandAvoids((prev) =>
        mergeLabelLists(
          prev,
          prefill.brandAvoids!
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
        ),
      );
    }
    if (prefill.hardAvoids) {
      setHardAvoids((prev) =>
        mergeLabelLists(
          prev,
          prefill.hardAvoids!
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
        ),
      );
    }
    if (prefill.honestyPreference) {
      setHonestyPreference(prefill.honestyPreference);
    }
    if (
      prefill.heightCm ||
      prefill.weightKg ||
      prefill.build ||
      prefill.muscularity ||
      prefill.bodyShape ||
      prefill.bustFullness
    ) {
      setPhotoValues((prev) => {
        const next = { ...prev };
        if (prefill.heightCm) {
          const cm = prefill.heightCm;
          next.heightCm = cm;
          next.heightUnit = "cm";
          next.heightFt = Math.floor(cm / 2.54 / 12);
          next.heightIn = Math.round((cm / 2.54) % 12);
        }
        if (prefill.weightKg) {
          next.weightValue = prefill.weightKg;
          next.weightUnit = "kg";
          next.weightSkipped = false;
        }
        if (prefill.build) {
          next.build = prefill.build as BuildKey;
          if (!next.muscularity) {
            next.muscularity = defaultMuscularityForBuild(
              prefill.build as BuildKey,
            );
          }
        }
        if (prefill.muscularity) {
          next.muscularity =
            prefill.muscularity as FittingPhotoValues["muscularity"];
        }
        if (prefill.bodyShape) {
          next.bodyShape =
            prefill.bodyShape as FittingPhotoValues["bodyShape"];
        }
        if (prefill.bustFullness) {
          next.bustFullness =
            prefill.bustFullness as FittingPhotoValues["bustFullness"];
        }
        return next;
      });
    }

    // Advance develop flags when free-text filled later steps early.
    setPersistedFlags((f) => ({
      ...f,
      spend:
        f.spend ||
        Boolean(prefill.budgetPhilosophy?.trim()),
      sizing:
        f.sizing ||
        Boolean(prefill.heightCm || prefill.weightKg || prefill.build),
      nolistSaved:
        f.nolistSaved ||
        Boolean(
          prefill.brandLikes?.trim() ||
            prefill.brandAvoids?.trim() ||
            prefill.hardAvoids?.trim(),
        ),
      tasteFinal: f.tasteFinal || Boolean(prefill.honestyPreference?.trim()),
    }));
  }, []);

  const hydrateFromStatus = useCallback(
    (next: OnboardingStatus, prefill?: OnboardingPrefill) => {
      setStatus(next);
      // Soft fields: never wipe client free-text with empty server values.
      if (next.profile?.preferredName?.trim()) {
        setPreferredName(next.profile.preferredName.trim());
      }
      if (next.profile?.genderPresentation?.trim()) {
        setGenderPresentation(
          normalizeGender(next.profile.genderPresentation),
        );
      }
      const bd = birthDateToInput(next.profile?.birthDate);
      if (bd) {
        setBirthDate(bd);
        setBirthDateSkipped(false);
      } else if (next.profile?.ageRange) {
        setBirthDateSkipped(true);
      }
      const nextEras = parseCsvValues(next.profile?.styleEra);
      if (nextEras.length) {
        setStyleEras((prev) => mergeLabelLists(prev, nextEras));
      }
      if (next.profile?.city?.trim()) setCity(next.profile.city.trim());
      if (next.profile?.shippingCountry?.trim() || next.profile?.country?.trim()) {
        setShippingCountry(
          next.profile.shippingCountry?.trim() ||
            next.profile.country?.trim() ||
            DEFAULT_SHIPPING_COUNTRY,
        );
      }
      if (next.profile?.currency?.trim()) {
        setCurrency(next.profile.currency.trim());
      }
      if (next.profile?.valuePhilosophy) {
        setBudgetPhilosophies((prev) =>
          mergeLabelLists(prev, parseCsvValues(next.profile!.valuePhilosophy)),
        );
      }
      const likedBrands = next.brandPreferences
        .filter((b) => b.sentiment === "love" || b.sentiment === "like")
        .map((b) => b.brand);
      if (likedBrands.length) {
        setBrandLikes((prev) => mergeLabelLists(prev, likedBrands));
      }
      const avoidedBrands = next.brandPreferences
        .filter((b) => b.sentiment === "avoid" || b.sentiment === "hate")
        .map((b) => b.brand);
      if (avoidedBrands.length) {
        setBrandAvoids((prev) => mergeLabelLists(prev, avoidedBrands));
      }
      if (next.hardNegatives.length) {
        setHardAvoids((prev) =>
          mergeLabelLists(
            prev,
            next.hardNegatives.map((h) => h.value),
          ),
        );
      }
      if (next.profile?.honestyPreference) {
        setHonestyPreference(next.profile.honestyPreference);
      }
      if (next.profile?.styleMix) setStyleMix(next.profile.styleMix);
      if (next.sizing?.heightCm) {
        const cm = next.sizing.heightCm;
        setPhotoValues((prev) => ({
          ...prev,
          heightCm: cm,
          heightUnit: "cm",
          heightFt: Math.floor(cm / 2.54 / 12),
          heightIn: Math.round((cm / 2.54) % 12),
        }));
      }
      if (next.sizing?.weightKg) {
        setPhotoValues((prev) => ({
          ...prev,
          weightValue: next.sizing!.weightKg!,
          weightUnit: "kg",
          weightSkipped: false,
        }));
      }
      if (next.sizing?.bodyType) {
        setPhotoValues((prev) => ({
          ...prev,
          build: next.sizing!.bodyType as BuildKey,
        }));
      }
      setPersistedFlags((prev) => ({
        ...prev,
        identity: profileYouSaved(next.profile),
        spend:
          prev.spend || Boolean(next.profile?.valuePhilosophy?.trim()),
        sizing:
          prev.sizing ||
          Boolean(next.sizing?.heightCm || next.sizing?.bodyType),
        tasteFinal:
          prev.tasteFinal ||
          Boolean(next.profile?.honestyPreference?.trim()),
        wornSaved:
          prev.wornSaved ||
          next.tasteTags.some((t) => t.category === "worn"),
        wantedSaved:
          prev.wantedSaved ||
          next.tasteTags.some((t) => t.category === "aspirational"),
        nolistSaved:
          prev.nolistSaved ||
          next.brandPreferences.length > 0 ||
          next.hardNegatives.length > 0,
      }));
      if (prefill) applyPrefill(prefill);
    },
    [applyPrefill],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    void (async () => {
      try {
        const next = await fetchStatus(ctrl.signal);
        if (ctrl.signal.aborted) return;
        if (next === "unauthorized") return;
        hydrateFromStatus(next);

        // Prefer profile, else real IP-detected area for ship-to.
        if (!next.profile?.shippingCountry?.trim() && detectedArea?.countryLabel) {
          setShippingCountry(detectedArea.countryLabel);
          const hint = currencyHintForCountry(detectedArea.countryLabel);
          if (hint) setCurrency(hint);
        }
        if (!next.profile?.city?.trim() && detectedArea?.cityLabel) {
          setCity(detectedArea.cityLabel);
        }

        const resume = resolveResumeStep(next);
        setStep(resume);
        writeOnboardingUiSession({ step: resume });
        const self = await fetchSelfPerson(ctrl.signal);
        if (self) {
          setSelfPersonId(self.id);
          if (self.hasAvatar && self.avatarUrl) {
            setTwinAvatarUrl(self.avatarUrl);
            setTwinStatus("ready");
            setTwinError(null);
            photoReadyRef.current = true;
            mintDoneRef.current = true;
            useSelfAvatarStore.getState().markReady(self.avatarUrl);
          }
        }
      } catch {
        if (!ctrl.signal.aborted) setError("Could not load onboarding.");
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    })();
    return () => ctrl.abort();
  }, [hydrateFromStatus, detectedArea]);

  useEffect(() => {
    if (loading || !status || status.onboarding.completed) return;
    writeOnboardingUiSession({ step });
  }, [loading, status, step]);

  const identityValues = useMemo<YouIdentityValues>(
    () => ({
      preferredName,
      genderPresentation,
      birthDate,
      birthDateSkipped,
      styleEras,
      lifestyleTags,
    }),
    [
      preferredName,
      genderPresentation,
      birthDate,
      birthDateSkipped,
      styleEras,
      lifestyleTags,
    ],
  );

  const identityOnChange = useCallback(
    <K extends keyof YouIdentityValues>(
      key: K,
      value: YouIdentityValues[K],
    ) => {
      switch (key) {
        case "preferredName":
          setPreferredName(value as string);
          break;
        case "genderPresentation":
          setGenderPresentation(value as string);
          break;
        case "birthDate":
          setBirthDate(value as string);
          break;
        case "birthDateSkipped":
          setBirthDateSkipped(value as boolean);
          break;
        case "styleEras":
          setStyleEras(value as string[]);
          break;
        case "lifestyleTags":
          break;
      }
    },
    [],
  );

  const photoOnChange = useCallback(
    <K extends keyof FittingPhotoValues>(
      key: K,
      value: FittingPhotoValues[K],
    ) => {
      setPhotoValues((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const valuePhilosophyWire = useMemo(() => {
    const known = new Set(BUDGET_OPTIONS.map((b) => b.value as string));
    const picked = budgetPhilosophies.filter((v) => known.has(v));
    const customs = budgetPhilosophies
      .filter((v) => v.startsWith("custom:"))
      .map((v) => v.slice(7));
    return joinCsvValues([...picked, ...customs]) || null;
  }, [budgetPhilosophies]);

  const loadOutfitDeck = useCallback(
    async (mode: "worn" | "aspirational", opts?: { more?: boolean }) => {
      const more = Boolean(opts?.more);
      const inFlight =
        mode === "worn" ? wornDeckInFlightRef : aspirationalDeckInFlightRef;
      if (inFlight.current) return;
      inFlight.current = true;
      const setLoadingState =
        mode === "worn"
          ? more
            ? setWornLoadingMore
            : setWornLoading
          : more
            ? setAspirationalLoadingMore
            : setAspirationalLoading;
      const setDeck = mode === "worn" ? setWornDeck : setAspirationalDeck;
      const setHasMore =
        mode === "worn" ? setWornHasMore : setAspirationalHasMore;
      const currentDeck = mode === "worn" ? wornDeck : aspirationalDeck;
      setLoadingState(true);
      try {
        const params = new URLSearchParams({ mode });
        if (genderPresentation.trim()) {
          params.set("genderPresentation", genderPresentation.trim());
        }
        if (styleEras.length) {
          params.set("styleEra", joinCsvValues(styleEras));
        }
        if (lifestyleTags.length) {
          params.set("lifestyleTags", lifestyleTags.join(","));
        }
        if (valuePhilosophyWire) {
          params.set("valuePhilosophy", valuePhilosophyWire);
        }
        if (brandLikes.length) params.set("brandLikes", brandLikes.join(","));
        if (brandAvoids.length)
          params.set("brandAvoids", brandAvoids.join(","));
        if (shippingCountry.trim()) {
          params.set("shippingCountry", shippingCountry.trim());
        }
        if (currency.trim()) params.set("currency", currency.trim());
        if (mode === "aspirational" && wornPickLabelsRef.current.length) {
          params.set("wornLabels", wornPickLabelsRef.current.join(","));
        }
        if (mode === "aspirational" && wornPickTasteTagsRef.current.length) {
          params.set("wornTasteTags", wornPickTasteTagsRef.current.join(","));
        }
        if (mode === "aspirational" && wornPicks.length) {
          params.set(
            "wornLookIds",
            wornPicks.map((p) => p.id).filter(Boolean).join(","),
          );
        }
        if (more && currentDeck.length) {
          params.set(
            "excludeLookIds",
            currentDeck.map((c) => c.id).filter(Boolean).join(","),
          );
        }
        const res = await fetch(`/api/onboarding/taste?${params}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error("deck");
        const json = (await res.json()) as {
          deck: OutfitGridCard[];
          hasMore?: boolean;
        };
        const next = json.deck ?? [];
        // Keep worn picks + closet when (re)loading decks
        if (!more && mode === "aspirational") setAspirationalPicks([]);
        if (more) {
          setDeck((prev) => {
            const seen = new Set(prev.map((c) => c.id));
            return [...prev, ...next.filter((c) => c.id && !seen.has(c.id))];
          });
        } else {
          setDeck(next);
        }
        // Prefer server flag; if omitted (stale response), assume more when we got a full page.
        const serverHasMore = json.hasMore;
        setHasMore(
          typeof serverHasMore === "boolean"
            ? serverHasMore
            : next.length >= 9,
        );
      } catch {
        if (!more && mode === "aspirational") setAspirationalPicks([]);
        if (!more) setDeck([]);
        if (!more) setHasMore(false);
      } finally {
        inFlight.current = false;
        setLoadingState(false);
      }
    },
    [
      genderPresentation,
      styleEras,
      lifestyleTags,
      valuePhilosophyWire,
      brandLikes,
      brandAvoids,
      shippingCountry,
      currency,
      wornPicks,
      wornDeck,
      aspirationalDeck,
    ],
  );

  useEffect(() => {
    if (step === "worn" && wornDeck.length === 0) {
      void loadOutfitDeck("worn");
    }
  }, [step, wornDeck.length, loadOutfitDeck]);

  useEffect(() => {
    if (step === "wanted" && aspirationalDeck.length === 0) {
      void loadOutfitDeck("aspirational");
    }
  }, [step, aspirationalDeck.length, loadOutfitDeck]);

  // If the first page loaded before hasMore was wired (or a stale response),
  // still offer See more — the next fetch will hide it when exhausted.
  useEffect(() => {
    if (
      step === "worn" &&
      wornDeck.length === 9 &&
      !wornHasMore &&
      !wornLoading
    ) {
      setWornHasMore(true);
    }
  }, [step, wornDeck.length, wornHasMore, wornLoading]);

  useEffect(() => {
    if (
      step === "wanted" &&
      aspirationalDeck.length === 9 &&
      !aspirationalHasMore &&
      !aspirationalLoading
    ) {
      setAspirationalHasMore(true);
    }
  }, [step, aspirationalDeck.length, aspirationalHasMore, aspirationalLoading]);

  useEffect(() => {
    return () => {
      mintAbortRef.current = true;
    };
  }, []);

  // Enter to advance
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      if (step === "verdict" || step === "honesty") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const btn = document.querySelector<HTMLButtonElement>(
        "[data-fitting-primary]",
      );
      btn?.click();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  /**
   * Black loading screen stays up until `work` finishes (real API / deck).
   * Minimum hold avoids a jarring 50ms flash on fast saves.
   */
  async function runWithLoading(opts: {
    from: Exclude<FittingStep, "verdict">;
    nextStep: FittingStep;
    work: () => Promise<boolean>;
    /** Extra status when preloading the next grid deck, etc. */
    detailExtra?: string;
  }): Promise<boolean> {
    const meta = STEP_META[opts.from];
    setError(null);
    setFlash({
      cover: meta.flashCover,
      status: meta.flashNext,
      detail: opts.detailExtra
        ? `${meta.loadingDetail} ${opts.detailExtra}`
        : meta.loadingDetail,
    });
    const started = Date.now();
    try {
      const ok = await opts.work();
      if (!ok) {
        setFlash(null);
        return false;
      }
      const elapsed = Date.now() - started;
      if (elapsed < 450) {
        await new Promise((r) => setTimeout(r, 450 - elapsed));
      }
      setStep(opts.nextStep);
      setFlash(null);
      return true;
    } catch (e) {
      setFlash(null);
      setError(e instanceof Error ? e.message : "Something went wrong.");
      return false;
    }
  }

  function showLoading(opts: {
    cover: string;
    status: string;
    detail: string;
  }) {
    setFlash(opts);
  }

  function hideLoading() {
    setFlash(null);
  }

  async function saveIdentity(): Promise<boolean> {
    if (submissionLockRef.current) return false;
    const missing: string[] = [];
    if (!preferredName.trim()) missing.push("name");
    if (!genderPresentation.trim()) missing.push("clothing style");
    const styleEraWire = joinCsvValues(styleEras);
    if (
      birthDate.trim() &&
      !birthDateSkipped &&
      !isAtLeastAge(birthDate, 13)
    ) {
      setError("You need to be at least 13 to use Shoop.");
      return false;
    }
    const ageFromDob =
      !birthDateSkipped && birthDate && isAtLeastAge(birthDate, 13)
        ? ageYearsFromBirthDate(birthDate)
        : null;
    const ageRange =
      ageFromDob != null
        ? normalizeAgeRange(String(ageFromDob))
        : styleEraToAgeRange(styleEraWire);
    if (!styleEraWire) missing.push("style era");
    else if (!ageRange) missing.push("style era");
    if (missing.length) {
      setError(`Almost there — just add your ${missing.join(" and ")}.`);
      return false;
    }

    submissionLockRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const requestKey =
        reviewRequestKeyRef.current ??
        (reviewRequestKeyRef.current = crypto.randomUUID());

      const patch = await fetch("/api/onboarding/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patch: {
            profile: {
              preferredName: preferredName.trim(),
              genderPresentation: genderPresentation.trim(),
              ageRange: normalizeAgeRange(ageRange) || ageRange,
              styleEra: styleEraWire,
              lifestyleTags,
              city: city.trim() || null,
              shippingCountry: shippingCountry.trim() || null,
              country: shippingCountry.trim() || null,
              currency: currency.trim() || null,
              birthDate:
                !birthDateSkipped &&
                birthDate &&
                isAtLeastAge(birthDate, 13)
                  ? new Date(`${birthDate}T12:00:00.000Z`).toISOString()
                  : null,
            },
          },
          requestKey,
        }),
      });
      const patchJson = (await patch.json()) as OnboardingStatus & {
        error?: string;
        selfPerson?: { id: string; hasAvatar: boolean } | null;
      };
      if (!patch.ok) {
        throw new Error(patchJson.error ?? "Could not save your profile.");
      }
      hydrateFromStatus(patchJson);
      reviewRequestKeyRef.current = null;
      if (patchJson.selfPerson?.id) {
        setSelfPersonId(patchJson.selfPerson.id);
      }
      setPersistedFlags((f) => ({ ...f, identity: true }));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your profile.");
      return false;
    } finally {
      submissionLockRef.current = false;
      setBusy(false);
    }
  }

  async function ensurePersonId(): Promise<string | null> {
    if (selfPersonId) return selfPersonId;
    const self = await fetchSelfPerson();
    if (self) {
      setSelfPersonId(self.id);
      return self.id;
    }
    return null;
  }

  async function startAvatarIfNeeded(personId: string) {
    if (avatarStartedRef.current) return;
    avatarStartedRef.current = true;
    try {
      const res = await guestFetch("/api/avatar/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ person_id: personId }),
      });
      if (!res.ok) avatarStartedRef.current = false;
    } catch {
      avatarStartedRef.current = false;
    }
  }

  async function pollAvatarJob(
    personId: string,
    jobId: string,
    startedAt: number,
  ): Promise<string | null> {
    if (mintAbortRef.current) return null;
    if (Date.now() - startedAt > TRYON_CLIENT_POLL_MAX_MS) return null;

    const res = await guestFetch(
      `/api/avatar/job/${jobId}?person_id=${encodeURIComponent(personId)}`,
    );
    const body = (await readAvatarJson(res)) as AvatarApiBody & {
      status?: string;
      variants?: AvatarCompareVariant[];
    };
    if (!res.ok || body.error) return null;

    const variants = body.variants ?? body.draft?.preview_variants ?? [];
    const settled =
      isCompareSettled(variants) || Boolean(body.draft?.preview_url);
    if (settled) {
      return (
        body.draft?.preview_url ??
        variants.find((v) => v.preview_url)?.preview_url ??
        null
      );
    }
    await new Promise((r) => setTimeout(r, TRYON_CLIENT_POLL_MS));
    return pollAvatarJob(personId, jobId, startedAt);
  }

  /**
   * Same sequence as CardForge mint, fire-and-forget during quiz:
   * measurements → check (intake merge) → attributes → FASHN generate → poll → approve.
   * Sends every body-related AvatarAttributes field we have so the prompt is complete.
   */
  async function kickBackgroundMint(opts: {
    personId: string;
    heightCm: number;
    build: BuildBand;
    muscularity: FittingPhotoValues["muscularity"];
    bodyShape: FittingPhotoValues["bodyShape"];
    bustFullness: FittingPhotoValues["bustFullness"];
    includeBust: boolean;
  }) {
    if (mintDoneRef.current || mintInFlightRef.current) return;
    if (!photoReadyRef.current) return;

    mintInFlightRef.current = true;
    setTwinStatus("developing");
    setTwinError(null);

    try {
      await startAvatarIfNeeded(opts.personId);

      let attrs = buildFittingAvatarAttributes({
        heightCm: opts.heightCm,
        build: opts.build,
        muscularity: opts.muscularity,
        bodyShape: opts.bodyShape,
        bustFullness: opts.bustFullness,
        includeBust: opts.includeBust,
      });

      const measRes = await guestFetch("/api/avatar/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "measurements",
          person_id: opts.personId,
          measurements: [
            { metric: "height", value: opts.heightCm, unit: "cm" },
          ],
        }),
      });
      if (!measRes.ok) {
        throw new Error("Could not save height to fashion memory.");
      }

      // Re-check merges photo intake suggestions (e.g. body_shape) under stated attrs.
      const checkRes = await guestFetch("/api/avatar/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "check",
          person_id: opts.personId,
          attributes: attrs,
        }),
      });
      const checkBody = await readAvatarJson(checkRes);
      if (checkBody.draft?.step === "refused_minor") {
        throw new Error(
          checkBody.draft.intake?.refusal_message ??
            "We can't use this photo.",
        );
      }
      if (checkRes.ok && !checkBody.error) {
        const suggested = checkBody.draft?.attributes ?? {};
        const clear = checkBody.draft?.intake?.clear ?? {};
        // User-stated wins; intake fills gaps only.
        attrs = {
          ...clear,
          ...suggested,
          ...attrs,
        };
        if (!attrs.body_shape && clear.body_shape) {
          attrs.body_shape = clear.body_shape;
        }
        // Keep bust only for feminine shoppers.
        if (!opts.includeBust) {
          delete attrs.bust_fullness;
        }
      }

      const attrRes = await guestFetch("/api/avatar/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "attributes",
          person_id: opts.personId,
          attributes: attrs,
        }),
      });
      const attrBody = await readAvatarJson(attrRes);
      if (!attrRes.ok || attrBody.error) {
        throw new Error(attrBody.error ?? "Could not save avatar attributes.");
      }

      const genRes = await guestFetch("/api/avatar/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          person_id: opts.personId,
          action: "generate",
          attributes: attrs,
        }),
      });
      const genBody = await readAvatarJson(genRes);
      if (!genRes.ok || genBody.error) {
        throw new Error(genBody.error ?? "Twin generation failed.");
      }

      let preview: string | null = genBody.draft?.preview_url ?? null;
      if (genBody.draft?.compare && genBody.draft.compare_job_id) {
        preview = await pollAvatarJob(
          opts.personId,
          genBody.draft.compare_job_id,
          Date.now(),
        );
      }

      if (!preview) {
        throw new Error("Twin mint produced no preview image.");
      }

      const approveRes = await guestFetch("/api/avatar/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          person_id: opts.personId,
          action: "approve",
        }),
      });
      const approveBody = await readAvatarJson(approveRes);
      let savedUrl = approveBody.avatar?.url ?? null;

      if (!approveRes.ok || !savedUrl) {
        const self = await fetchSelfPerson();
        if (self?.hasAvatar && self.avatarUrl) savedUrl = self.avatarUrl;
      }

      if (!savedUrl && !preview) {
        throw new Error(
          approveBody.error ?? "Twin generated but could not be saved.",
        );
      }

      const finalUrl = savedUrl ?? preview;
      mintDoneRef.current = true;
      setTwinAvatarUrl(finalUrl);
      setTwinStatus("ready");
      setTwinError(null);
      useSelfAvatarStore.getState().markReady(finalUrl);
      void useSelfAvatarStore.getState().refresh();
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Twin mint failed.";
      console.error("[shoop] background twin mint failed", e);
      setTwinError(msg);
      setTwinStatus("error");
    } finally {
      mintInFlightRef.current = false;
    }
  }

  async function uploadPhoto(file: File) {
    const preview = URL.createObjectURL(file);
    setPhotoValues((p) => ({ ...p, photoPreview: preview }));
    setLocalFacePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return preview;
    });
    setTwinStatus("idle");
    setTwinError(null);
    photoReadyRef.current = false;
    mintDoneRef.current = false;

    const personId = await ensurePersonId();
    if (!personId) {
      setError(
        "Save your name first so we can attach the photo to your profile.",
      );
      return;
    }
    await startAvatarIfNeeded(personId);

    try {
      const form = new FormData();
      form.append("person_id", personId);
      form.append("photo", file);
      const res = await guestFetch("/api/avatar/upload", {
        method: "POST",
        body: form,
      });
      const body = await readAvatarJson(res);
      if (!res.ok || body.error) {
        setError(body.error ?? "Could not upload photo. Try another.");
        return;
      }
      if (body.draft?.step === "refused_minor") {
        setError(
          body.draft.intake?.refusal_message ?? "We can't use this photo.",
        );
        photoReadyRef.current = false;
        return;
      }

      const checkRes = await guestFetch("/api/avatar/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check", person_id: personId }),
      });
      const checkBody = await readAvatarJson(checkRes);
      if (checkBody.draft?.step === "refused_minor") {
        setError(
          checkBody.draft.intake?.refusal_message ??
            "We can't use this photo.",
        );
        photoReadyRef.current = false;
        return;
      }

      // Apply soft body_shape suggestion from full-body intake if user has none yet.
      const suggestedShape =
        checkBody.draft?.intake?.clear?.body_shape ??
        checkBody.draft?.attributes?.body_shape;
      if (suggestedShape) {
        setPhotoValues((p) =>
          p.bodyShape ? p : { ...p, bodyShape: suggestedShape },
        );
      }

      photoReadyRef.current = true;
      setError(null);
    } catch {
      setError("Upload failed — try another photo.");
    }
  }

  async function saveSpend(): Promise<boolean> {
    if (!valuePhilosophyWire) {
      // Optional — allow skip, still return true
      return true;
    }
    if (submissionLockRef.current) return false;
    submissionLockRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patch: {
            profile: { valuePhilosophy: valuePhilosophyWire },
          },
          requestKey: crypto.randomUUID(),
        }),
      });
      const json = (await res.json()) as OnboardingStatus & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Could not save spend style.");
      hydrateFromStatus(json);
      setPersistedFlags((f) => ({ ...f, spend: true }));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save spend style.");
      return false;
    } finally {
      submissionLockRef.current = false;
      setBusy(false);
    }
  }

  async function savePhotoAndAttrs(): Promise<boolean> {
    if (submissionLockRef.current) return false;
    submissionLockRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const heightCm = heightCmFromPhoto(photoValues);
      const weightKg = weightKgFromPhoto(photoValues);
      const build = (photoValues.build ?? "average") as BuildBand;
      const sizing: Record<string, unknown> = {
        heightCm,
        bodyType: build,
      };
      if (weightKg != null) sizing.weightKg = weightKg;

      const patch = await fetch("/api/onboarding/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patch: {
            profile: {
              unitsLength: photoValues.heightUnit === "ft" ? "in" : "cm",
              unitsWeight: photoValues.weightUnit === "lb" ? "lb" : "kg",
              ...(valuePhilosophyWire
                ? { valuePhilosophy: valuePhilosophyWire }
                : {}),
            },
            sizing,
          },
          requestKey: crypto.randomUUID(),
        }),
      });
      const json = (await patch.json()) as OnboardingStatus & {
        error?: string;
        selfPerson?: { id: string } | null;
      };
      if (!patch.ok) {
        throw new Error(json.error ?? "Could not save your measurements.");
      }
      hydrateFromStatus(json);
      if (json.selfPerson?.id) setSelfPersonId(json.selfPerson.id);
      setPersistedFlags((f) => ({
        ...f,
        sizing: true,
        spend: f.spend || Boolean(valuePhilosophyWire),
      }));

      const personId =
        json.selfPerson?.id ?? selfPersonId ?? (await ensurePersonId());

      if (personId && photoReadyRef.current) {
        void kickBackgroundMint({
          personId,
          heightCm,
          build,
          muscularity: photoValues.muscularity,
          bodyShape: photoValues.bodyShape,
          bustFullness: photoValues.bustFullness,
          includeBust: normalizeGender(genderPresentation) === "feminine",
        });
      }

      return true;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save your measurements.",
      );
      return false;
    } finally {
      submissionLockRef.current = false;
      setBusy(false);
    }
  }

  async function saveTaste(
    complete: boolean,
    mark?: "worn" | "wanted" | "nolist" | "final",
  ): Promise<boolean> {
    if (submissionLockRef.current) return false;
    submissionLockRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding/taste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wornPicks: wornPicks.map((p) => ({
            id: p.id,
            label: p.label,
            tasteTags: p.tasteTags,
            productTitle: p.title,
            productId: p.productId ?? p.id,
            archetype: p.archetype,
          })),
          aspirationalPicks: aspirationalPicks.map((p) => ({
            id: p.id,
            label: p.label,
            tasteTags: p.tasteTags,
            productTitle: p.title,
            productId: p.productId ?? p.id,
            archetype: p.archetype,
          })),
          brandLikes,
          brandAvoids,
          hardAvoids,
          compliments: [],
          honestyPreference: honestyPreference || null,
          valuePhilosophy: valuePhilosophyWire,
          complete,
        }),
      });
      const next = (await res.json()) as OnboardingStatus & {
        error?: string;
        styleMix?: StyleMix | null;
      };
      if (!res.ok) {
        throw new Error(next.error ?? "Could not save your taste.");
      }
      hydrateFromStatus(next);
      if (next.styleMix) setStyleMix(next.styleMix);
      else if (next.profile?.styleMix) setStyleMix(next.profile.styleMix);
      setPersistedFlags((f) => ({
        ...f,
        wornSaved: f.wornSaved || mark === "worn" || wornPicks.length > 0,
        wantedSaved:
          f.wantedSaved || mark === "wanted" || aspirationalPicks.length > 0,
        nolistSaved:
          f.nolistSaved ||
          mark === "nolist" ||
          brandLikes.length + brandAvoids.length + hardAvoids.length > 0,
        tasteFinal: f.tasteFinal || mark === "final" || complete,
        spend: f.spend || Boolean(valuePhilosophyWire),
      }));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your taste.");
      return false;
    } finally {
      submissionLockRef.current = false;
      setBusy(false);
    }
  }

  async function waitForMintIfRunning(maxMs = 12_000) {
    if (!mintInFlightRef.current) return;
    const start = Date.now();
    while (mintInFlightRef.current && Date.now() - start < maxMs) {
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  async function completeOnboarding() {
    if (submissionLockRef.current) return;
    submissionLockRef.current = true;
    setBusy(true);
    setError(null);
    showLoading({
      cover: "Opening<br><em>the Mirror.</em>",
      status: "finishing your print…",
      detail: mintInFlightRef.current
        ? "Waiting for your twin mint, then marking onboarding complete…"
        : "Saving final state and starting your projection jobs…",
    });
    try {
      // Brief wait if FASHN is still minting — do not fake "ready".
      submissionLockRef.current = false;
      await waitForMintIfRunning(15_000);
      submissionLockRef.current = true;

      // Ensure final taste is on server before completing
      submissionLockRef.current = false;
      const tasteOk = await saveTaste(false, "final");
      submissionLockRef.current = true;
      if (!tasteOk) {
        throw new Error("Could not save final taste before complete.");
      }

      const res = await fetch("/api/onboarding", { method: "POST" });
      const next = (await res.json()) as OnboardingStatus & { error?: string };
      if (!res.ok) {
        submissionLockRef.current = false;
        const tasteRes = await saveTaste(true, "final");
        submissionLockRef.current = true;
        if (!tasteRes) {
          throw new Error(next.error ?? "Could not finish onboarding.");
        }
      } else {
        hydrateFromStatus(next);
      }
      useUserProfileStore.getState().setOnboardingCompleted(true);
      void useUserProfileStore.getState().hydrate({ force: true });
      void useSelfAvatarStore.getState().refresh();
      clearOnboardingUiSession();
      setHoldOpen(false);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not finish onboarding.",
      );
    } finally {
      hideLoading();
      submissionLockRef.current = false;
      setBusy(false);
    }
  }

  async function advanceFrom(current: FittingStep) {
    setError(null);
    if (current === "name") {
      await runWithLoading({
        from: "name",
        nextStep: "spend",
        work: () => saveIdentity(),
      });
      return;
    }
    if (current === "spend") {
      await runWithLoading({
        from: "spend",
        nextStep: "photo",
        work: () => saveSpend(),
      });
      return;
    }
    if (current === "photo") {
      await runWithLoading({
        from: "photo",
        nextStep: "worn",
        work: async () => {
          const ok = await savePhotoAndAttrs();
          if (!ok) return false;
          // Prefetch worn deck while user is on the loading screen
          await loadOutfitDeck("worn");
          return true;
        },
        detailExtra: "Loading your wardrobe grid…",
      });
      return;
    }
    if (current === "worn") {
      await runWithLoading({
        from: "worn",
        nextStep: "wanted",
        work: async () => {
          const ok = await saveTaste(false, "worn");
          if (!ok) return false;
          await loadOutfitDeck("aspirational");
          return true;
        },
        detailExtra: "Loading steal-closet looks…",
      });
      return;
    }
    if (current === "wanted") {
      await runWithLoading({
        from: "wanted",
        nextStep: "nolist",
        work: () => saveTaste(false, "wanted"),
      });
      return;
    }
    if (current === "nolist") {
      await runWithLoading({
        from: "nolist",
        nextStep: "honesty",
        work: () => saveTaste(false, "nolist"),
      });
      return;
    }
    if (current === "honesty") {
      await runWithLoading({
        from: "honesty",
        nextStep: "verdict",
        work: async () => {
          const ok = await saveTaste(false, "final");
          if (!ok) return false;
          setHoldOpen(true);
          return true;
        },
      });
    }
  }

  function goBack() {
    setError(null);
    const idx = FITTING_STEPS.indexOf(step);
    if (idx <= 0) return;
    setStep(FITTING_STEPS[idx - 1]!);
  }

  async function handleTell(text: string) {
    const trimmed = text.trim();
    if (!trimmed || tellBusy) return;

    setTellBusy(true);
    setTellFeedback("Reading that…");
    try {
      const res = await fetch("/api/onboarding/fitting-tell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: trimmed,
          known: {
            preferredName: preferredName.trim() || undefined,
            genderPresentation: genderPresentation || undefined,
            styleEras: styleEras.length ? styleEras : undefined,
            budgetPhilosophies: budgetPhilosophies.length
              ? budgetPhilosophies
              : undefined,
            brandLikes: brandLikes.length ? brandLikes : undefined,
            brandAvoids: brandAvoids.length ? brandAvoids : undefined,
            hardAvoids: hardAvoids.length ? hardAvoids : undefined,
            honestyPreference: honestyPreference || undefined,
            heightCm: photoValues.heightCm || null,
            weightKg:
              photoValues.weightValue != null && photoValues.weightUnit === "kg"
                ? photoValues.weightValue
                : photoValues.weightValue != null &&
                    photoValues.weightUnit === "lb"
                  ? Math.round(photoValues.weightValue * 0.453592)
                  : null,
            build: photoValues.build,
            currentStep: step,
          },
        }),
      });
      const json = (await res.json()) as OnboardingStatus & {
        error?: string;
        summary?: string;
        filled?: string[];
        deferredNote?: string;
        prefill?: OnboardingPrefill;
        extraction?: {
          preferredName?: string;
          genderPresentation?: string;
          styleEras?: string[];
          budgetPhilosophies?: string[];
          brandLikes?: string[];
          brandAvoids?: string[];
          hardAvoids?: string[];
          honestyPreference?: string;
          muscularity?: string;
          bodyShape?: string;
          bustFullness?: string;
          weightKg?: number;
          build?: string;
          heightCm?: number;
          heightFt?: number;
          heightIn?: number;
        };
      };
      if (!res.ok) {
        setTellFeedback(json.error ?? "Couldn't parse that — try again.");
        setTimeout(() => setTellFeedback(null), 4000);
        return;
      }

      // Build full prefill (incl. UI-only body fields + brands) and latch it
      // so identity/spend saves later can't drop chips for future steps.
      const extractedHeight =
        json.extraction?.heightCm ??
        (json.extraction?.heightFt != null
          ? Math.round(
              (json.extraction.heightFt * 12 +
                (json.extraction.heightIn ?? 0)) *
                2.54,
            )
          : undefined);
      const richPrefill: OnboardingPrefill = {
        ...json.prefill,
        heightCm: extractedHeight ?? json.prefill?.heightCm,
        weightKg: json.extraction?.weightKg ?? json.prefill?.weightKg,
        build: json.extraction?.build ?? json.prefill?.build,
        muscularity: json.extraction?.muscularity,
        bodyShape: json.extraction?.bodyShape,
        bustFullness: json.extraction?.bustFullness,
        brandLikes:
          json.extraction?.brandLikes?.join(", ") ?? json.prefill?.brandLikes,
        brandAvoids:
          json.extraction?.brandAvoids?.join(", ") ??
          json.prefill?.brandAvoids,
        hardAvoids:
          json.extraction?.hardAvoids?.join(", ") ?? json.prefill?.hardAvoids,
        budgetPhilosophy:
          json.extraction?.budgetPhilosophies?.join(",") ??
          json.prefill?.budgetPhilosophy,
        honestyPreference:
          json.extraction?.honestyPreference ??
          json.prefill?.honestyPreference,
      };
      tellLatchRef.current = mergePrefillLatch(
        tellLatchRef.current,
        richPrefill,
      );

      hydrateFromStatus(json, tellLatchRef.current);

      const filled = json.filled?.length
        ? ` · ${json.filled.join(", ")}`
        : "";
      const deferred = json.deferredNote?.trim() ?? "";
      setTellFeedback(
        `✓ ${json.summary?.trim() || "Form updated"}${filled}${deferred}`,
      );
      setTimeout(() => setTellFeedback(null), 6000);
    } catch {
      setTellFeedback("Network error — try again.");
      setTimeout(() => setTellFeedback(null), 4000);
    } finally {
      setTellBusy(false);
    }
  }

  const developPct = developPctFromFlags({
    identity: persistedFlags.identity || profileYouSaved(status?.profile ?? null),
    spend:
      persistedFlags.spend || Boolean(status?.profile?.valuePhilosophy?.trim()),
    sizing: persistedFlags.sizing || Boolean(status?.sizing?.heightCm),
    photoAccepted: photoReadyRef.current || Boolean(localFacePreview),
    twinReady: twinStatus === "ready" && Boolean(twinAvatarUrl),
    wornSaved: persistedFlags.wornSaved,
    wantedSaved: persistedFlags.wantedSaved,
    nolistSaved: persistedFlags.nolistSaved,
    tasteFinal: persistedFlags.tasteFinal,
    verdict: step === "verdict",
    dressed: dressStatus === "ready" && Boolean(dressedAvatarUrl),
  });

  /**
   * On the verdict step: pick one worn style and FASHN-dress it onto the minted twin.
   * Uses image provenance (in-house style photo, not Shopify).
   */
  useEffect(() => {
    if (step !== "verdict") return;
    if (dressKickRef.current) return;
    if (twinStatus !== "ready" || !twinAvatarUrl) return;
    if (dressStatus === "ready" || dressStatus === "dressing") return;

    const pick =
      wornPicks.find((p) => Boolean(p.imageUrl?.trim())) ??
      (closetImages[0]
        ? {
            id: closetImages[0].match(/\/([^/]+)\.\w+$/)?.[1] ?? "worn-0",
            label: "your worn pick",
            imageUrl: closetImages[0],
          }
        : null);
    if (!pick?.imageUrl?.trim()) {
      dressKickRef.current = true;
      return;
    }

    dressKickRef.current = true;
    const styleId = pick.id;
    const title = pick.label || "worn look";
    const imageUrl = pick.imageUrl.trim();

    void (async () => {
      setDressStatus("dressing");
      setDressError(null);
      setDressStyleLabel(title);
      try {
        const absolute = /^https?:\/\//i.test(imageUrl)
          ? imageUrl
          : `${window.location.origin}${imageUrl.startsWith("/") ? "" : "/"}${imageUrl}`;
        const res = await fetch("/api/tryon/fitting-room", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: [
              {
                provenance: {
                  kind: "image",
                  imageUrl: absolute,
                  styleId,
                  title,
                  garment: `${title} styled full outfit dress look`,
                },
              },
            ],
          }),
        });
        const body = (await res.json()) as { error?: string; jobId?: string };
        if (!res.ok || !body.jobId) {
          throw new Error(body.error ?? "Could not start dress.");
        }
        const startedAt = Date.now();
        let finalUrl: string | null = null;
        while (Date.now() - startedAt <= TRYON_CLIENT_POLL_MAX_MS) {
          const pollRes = await fetch(
            `/api/tryon/fitting-room/${body.jobId}`,
          );
          const pollBody = (await pollRes.json()) as {
            error?: string;
            tryon_look?: {
              status?: string;
              final_image_url?: string;
              partial_note?: string;
              compare?: boolean;
              variants?: Array<{ image_url?: string; status?: string }>;
            };
          };
          if (!pollRes.ok) {
            throw new Error(pollBody.error ?? "Dress poll failed.");
          }
          const look = pollBody.tryon_look;
          if (look?.status === "completed" && look.final_image_url) {
            finalUrl = look.final_image_url;
            break;
          }
          if (look?.compare) {
            const any =
              look.final_image_url ||
              look.variants?.find((v) => v.image_url)?.image_url;
            const settled = (look.variants ?? []).every(
              (v) => v.status === "completed" || v.status === "failed",
            );
            if (any && settled) {
              finalUrl = any;
              break;
            }
            if (look.status === "failed" && !any) {
              throw new Error(
                look.partial_note ?? "Could not dress this look.",
              );
            }
          } else if (look?.status === "failed") {
            throw new Error(
              look.partial_note ?? "Could not dress this look.",
            );
          }
          await new Promise((r) => setTimeout(r, TRYON_CLIENT_POLL_MS));
        }
        if (!finalUrl) {
          throw new Error("Dress timed out — open the Mirror later.");
        }
        setDressedAvatarUrl(finalUrl);
        setDressStatus("ready");
      } catch (e) {
        setDressStatus("error");
        setDressError(
          e instanceof Error ? e.message : "Could not dress your twin.",
        );
      }
    })();
  }, [
    step,
    twinStatus,
    twinAvatarUrl,
    wornPicks,
    closetImages,
    dressStatus,
  ]);

  const mirror = useMemo<MirrorState>(() => {
    const eraShorts = styleEras.map((e) => {
      const row = STYLE_ERAS.find((x) => x.value === e);
      return shortEraLabel(row?.label ?? e);
    });
    const eraLabel =
      eraShorts.length === 0
        ? ""
        : eraShorts.length <= 2
          ? eraShorts.join(" + ")
          : `${eraShorts.slice(0, 2).join(" + ")} +${eraShorts.length - 2}`;

    const known = new Set(BUDGET_OPTIONS.map((b) => b.value as string));
    const spendBits = budgetPhilosophies.map((v) =>
      known.has(v)
        ? spendShort(v)
        : v.startsWith("custom:")
          ? v.slice(7).slice(0, 10)
          : spendShort(v),
    );
    const spendLabel = spendBits.join(" · ");
    const lean = leanFromPicks(wornPicks, aspirationalPicks, styleMix);
    const vetoN = hardAvoids.length + brandAvoids.length;
    const displayTwinUrl =
      dressStatus === "ready" && dressedAvatarUrl
        ? dressedAvatarUrl
        : twinAvatarUrl;

    return {
      ...EMPTY_MIRROR,
      name: preferredName.trim(),
      eraLabel,
      spendLabel,
      leanLabel: lean,
      brandsLabel: brandLikes.length ? `${brandLikes.length} loved` : "",
      noListLabel: vetoN ? `${vetoN} refused` : "",
      photoUrl: localFacePreview,
      twinAvatarUrl: displayTwinUrl,
      heightCm: heightCmFromPhoto(photoValues),
      build: photoValues.build,
      muscularity: photoValues.muscularity,
      bodyShape: photoValues.bodyShape,
      bustFullness:
        normalizeGender(genderPresentation) === "feminine"
          ? photoValues.bustFullness
          : null,
      form: formFromGender(genderPresentation),
      developPct,
      twinStatus,
      twinError,
      dressStatus,
      dressError,
      dressStyleLabel,
      closetImages,
      serial: selfPersonId ? stubSerialFromId(selfPersonId) : "——",
      foil:
        step === "verdict" &&
        twinStatus === "ready" &&
        dressStatus === "ready",
    };
  }, [
    preferredName,
    styleEras,
    budgetPhilosophies,
    wornPicks,
    aspirationalPicks,
    styleMix,
    hardAvoids,
    brandAvoids,
    brandLikes,
    localFacePreview,
    twinAvatarUrl,
    dressedAvatarUrl,
    photoValues,
    genderPresentation,
    developPct,
    twinStatus,
    twinError,
    dressStatus,
    dressError,
    dressStyleLabel,
    closetImages,
    selfPersonId,
    step,
  ]);

  const progressPct =
    step === "verdict"
      ? 100
      : STEP_PROGRESS_PCT[
          Math.max(
            0,
            FITTING_Q_STEPS.indexOf(
              step as (typeof FITTING_Q_STEPS)[number],
            ),
          )
        ] ?? 7;

  const stepMeta =
    step === "verdict"
      ? { n: 7, stage: "THE FITTING" }
      : STEP_META[step];

  if (loading) {
    return (
      <FittingFlash
        show
        coverHtml="Opening<br><em>The Fitting.</em>"
        statusLabel="loading your print…"
        detail="Fetching your profile…"
      />
    );
  }

  if (
    (!status?.onboarding || status.onboarding.completed) &&
    !holdOpen
  ) {
    return null;
  }

  // Initial bootstrap uses FittingFlash black screen (not a separate light panel).
  // Keep shell mounted only after load so flash can cover it during step work.

  return (
    <>
      <FittingFlash
        show={Boolean(flash)}
        coverHtml={flash?.cover ?? ""}
        statusLabel={flash?.status ?? ""}
        detail={flash?.detail ?? null}
      />
      <FittingShell
        step={step}
        progressPct={progressPct}
        stageLabel={
          step === "verdict" ? "THE FITTING" : stepMeta.stage
        }
        stepCountLabel={
          step === "verdict" ? "DONE" : `${stepMeta.n} of 7`
        }
        mirror={mirror}
        onTell={handleTell}
        tellFeedback={tellFeedback}
        tellBusy={tellBusy}
      >
        {step !== "verdict" && step !== "name" ? (
          <FittingBackLink onClick={goBack} />
        ) : null}
        {step !== "verdict" ? (
          <FittingCount n={stepMeta.n} total={7} />
        ) : null}

        {step === "name" ? (
          <YouIdentityStep
            values={identityValues}
            onChange={identityOnChange}
            onContinue={() => void advanceFrom("name")}
            busy={busy}
          />
        ) : null}

        {step === "spend" ? (
          <TasteSpendStep
            values={budgetPhilosophies}
            onChange={setBudgetPhilosophies}
            customLabels={customSpendLabels}
            onCustomLabelsChange={setCustomSpendLabels}
            onContinue={() => void advanceFrom("spend")}
            busy={busy}
          />
        ) : null}

        {step === "photo" ? (
          <FittingPhotoStep
            values={photoValues}
            onChange={photoOnChange}
            onPhotoFile={(f) => void uploadPhoto(f)}
            onSkipPhoto={() => {
              photoReadyRef.current = false;
              void advanceFrom("photo");
            }}
            onContinue={() => void advanceFrom("photo")}
            busy={busy}
            showContinue
            showBust={normalizeGender(genderPresentation) === "feminine"}
          />
        ) : null}

        {step === "worn" ? (
          <TasteOutfitGridStep
            mode="worn"
            cards={wornDeck}
            selectedIds={wornPicks.map((p) => p.id)}
            maxPicks={3}
            loading={wornLoading}
            loadingMore={wornLoadingMore}
            hasMore={wornHasMore}
            onSeeMore={() => void loadOutfitDeck("worn", { more: true })}
            onToggle={(card) =>
              setWornPicks((prev) => togglePick(prev, card, 3))
            }
            why="Your real wardrobe is my starting point. The dream comes next."
            onContinue={() => void advanceFrom("worn")}
            busy={busy}
          />
        ) : null}

        {step === "wanted" ? (
          <TasteOutfitGridStep
            mode="aspirational"
            cards={aspirationalDeck}
            selectedIds={aspirationalPicks.map((p) => p.id)}
            maxPicks={2}
            loading={aspirationalLoading}
            loadingMore={aspirationalLoadingMore}
            hasMore={aspirationalHasMore}
            onSeeMore={() =>
              void loadOutfitDeck("aspirational", { more: true })
            }
            onToggle={(card) =>
              setAspirationalPicks((prev) => togglePick(prev, card, 2))
            }
            why="Where you're headed matters as much as where you are. I dress both."
            onContinue={() => void advanceFrom("wanted")}
            busy={busy}
          />
        ) : null}

        {step === "nolist" ? (
          <TasteLovesVetoesStep
            context={{
              genderPresentation,
              styleEra: joinCsvValues(styleEras),
              lifestyleTags,
              valuePhilosophy: valuePhilosophyWire ?? "",
              shippingCountry,
              wornLabels: wornPicks.map((p) => p.label),
              aspirationalLabels: aspirationalPicks.map((p) => p.label),
              wornTasteTags: wornPicks.flatMap((p) => p.tasteTags ?? []),
              aspirationalTasteTags: aspirationalPicks.flatMap(
                (p) => p.tasteTags ?? [],
              ),
            }}
            brandLikes={brandLikes}
            brandAvoids={brandAvoids}
            hardAvoids={hardAvoids}
            onChangeBrandLikes={setBrandLikes}
            onChangeBrandAvoids={setBrandAvoids}
            onChangeHardAvoids={setHardAvoids}
            onContinue={() => void advanceFrom("nolist")}
            busy={busy}
          />
        ) : null}

        {step === "honesty" ? (
          <TasteHonestyStep
            value={honestyPreference}
            onChange={setHonestyPreference}
            onContinue={() => void advanceFrom("honesty")}
            busy={busy}
          />
        ) : null}

        {step === "verdict" ? (
          <FittingVerdictStep
            preferredName={preferredName}
            wornLabels={wornPicks.map((p) => p.label)}
            stealLabels={aspirationalPicks.map((p) => p.label)}
            leanLabel={mirror.leanLabel}
            form={mirror.form}
            build={photoValues.build}
            vetoCount={hardAvoids.length + brandAvoids.length}
            developPct={mirror.developPct}
            dressStatus={dressStatus}
            dressStyleLabel={dressStyleLabel}
            busy={busy}
            onMeetTwin={() => void completeOnboarding()}
            shareCopied={shareCopied}
            onShare={() => {
              const text = `My Shoop verdict: I love ${wornPicks.map((p) => p.label).join(", ") || "comfort"}, drawn to ${aspirationalPicks.map((p) => p.label).join(", ") || "more"}. ${hardAvoids.length + brandAvoids.length} hard vetoes. shoop.world`;
              void navigator.clipboard?.writeText(text).then(() => {
                setShareCopied(true);
                setTimeout(() => setShareCopied(false), 2000);
              });
            }}
          />
        ) : null}

        {error ? (
          <p className="mt-4 max-w-lg rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}

        {/* hidden trigger for enter-key */}
        {step !== "verdict" ? (
          <button
            type="button"
            data-fitting-primary
            className="sr-only"
            onClick={() => void advanceFrom(step)}
          >
            next
          </button>
        ) : null}

        {/* keep styleMix referenced for future narration */}
        <span className="sr-only">{styleMix ? JSON.stringify(styleMix) : ""}</span>
        <span className="sr-only">{styleEraLabel(joinCsvValues(styleEras))}</span>
      </FittingShell>
    </>
  );
}
