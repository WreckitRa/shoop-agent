"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FittingFlash } from "@/components/onboarding/fitting/FittingFlash";
import { FittingMirror } from "@/components/onboarding/fitting/FittingMirror";
import {
  FittingPhotoStep,
  defaultMuscularityForBuild,
  type FittingPhotoValues,
} from "@/components/onboarding/fitting/FittingPhotoStep";
import { FittingConsentStep } from "@/components/onboarding/fitting/FittingConsentStep";
import {
  getPendingFittingPhoto,
  loadPersistedFittingPhoto,
  setPendingFittingPhoto,
} from "@/components/onboarding/fitting/pending-photo";
import {
  clearGuestPhotoLive,
  markGuestPhotoLive,
} from "@/lib/client/guest-photo-abandon";
import {
  BIOMETRIC_CONSENT_EVENT,
  BiometricConsentSheet,
  notifyBiometricConsent,
} from "@/components/legal/BiometricConsentSheet";
import { FittingShell } from "@/components/onboarding/fitting/FittingShell";
import { FittingVerdictStep } from "@/components/onboarding/fitting/FittingVerdictStep";
import {
  FittingAnalysisPanel,
  type ScanUiPayload,
} from "@/components/onboarding/fitting/FittingAnalysisPanel";
import type { StylistVerdict } from "@/lib/photo-analysis/verdict";
import {
  EMPTY_MIRROR,
  FITTING_Q_STEPS,
  FITTING_STEPS,
  STEP_META,
  STEP_PROGRESS_PCT,
  circleMirrorLabel,
  formFromGender,
  shortEraLabel,
  spendShort,
  printSerialFromId,
  type BuildKey,
  type FittingStep,
  type MirrorState,
} from "@/components/onboarding/fitting/types";
import {
  clearOnboardingUiSession,
  readOnboardingUiSession,
  writeOnboardingUiSession,
} from "@/components/onboarding/fitting/ui-session";
import { TasteCircleStep } from "@/components/onboarding/TasteCircleStep";
import { TasteHonestyStep } from "@/components/onboarding/TasteHonestyStep";
import { TasteLifeStep, type TasteLifeValues } from "@/components/onboarding/TasteLifeStep";
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
import { useInlineFittingStore } from "@/components/onboarding/inline-fitting-store";
import { resolveFittingResumeStep } from "@/components/onboarding/fitting/resume-step";
import { useInlineFittingSlots } from "@/components/onboarding/useInlineFittingSlot";
import { useSelfAvatarStore } from "@/components/tryon/self-avatar-store";
import { useAppSessionStore } from "@/lib/client/app-session";
import { useClientIdentityScopeKey } from "@/lib/client/identity-sync";
import { openAuthModal } from "@/hooks/useGuestMode";
import {
  guestFetch,
  guestFetchWithRetry,
  isRateLimitedResponse,
  retryAfterMs,
} from "@/lib/client/guest-fetch";
import { fillPhotoAnalysisForm, type PhotoAnalysisPublic } from "@/lib/photo-analysis/types";
import { photoScanPhase } from "@/lib/photo-analysis/scan-phase";
import type { PhotoCoverage } from "@/lib/photo-analysis/result";
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
  lifestyleTagsFromLife,
  isComfortConstraint,
  normalizeAgeRange,
  normalizeClimate,
  normalizeGender,
  normalizeHonestyPreference,
  parseCsvValues,
  styleEraToAgeRange,
} from "@/lib/onboarding/form-options";
import { MIN_ACCOUNT_AGE } from "@/lib/legal/constants";
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

/** Typical FASHN twin generate — bar asymptotes at 92% until approve. */
const TWIN_PRINT_EXPECTED_MS = 55_000;

type AvatarApiBody = {
  error?: string;
  avatar?: { url?: string };
    draft?: {
    person_id?: string;
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

function silhouetteMintKey(opts: {
  heightCm: number;
  build: BuildBand;
  muscularity: FittingPhotoValues["muscularity"];
  bodyShape: FittingPhotoValues["bodyShape"];
  bustFullness: FittingPhotoValues["bustFullness"];
  includeBust: boolean;
}): string {
  return [
    opts.heightCm,
    opts.build,
    opts.muscularity ?? "",
    opts.bodyShape ?? "",
    opts.bustFullness ?? "",
    opts.includeBust ? "1" : "0",
  ].join("|");
}

function userFacingTwinMintError(err: unknown): string {
  const raw = err instanceof Error ? err.message : "Twin mint failed.";
  if (
    /tryon upload failed|fetch failed|signed url|fetch provider image/i.test(
      raw,
    )
  ) {
    return "Could not save your twin. Print it again.";
  }
  return raw;
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
  comfort?: string;
  weekIs?: string;
  dressingFor?: string;
  kids?: string;
  climate?: string;
  honestyPreference?: string;
  circleNames?: string;
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
    comfort: mergeCsvLabels(prev.comfort, next.comfort) ?? prev.comfort,
    weekIs: next.weekIs?.trim() || prev.weekIs,
    dressingFor: next.dressingFor?.trim() || prev.dressingFor,
    kids: next.kids?.trim() || prev.kids,
    climate: next.climate?.trim() || prev.climate,
    honestyPreference:
      next.honestyPreference?.trim() || prev.honestyPreference,
    circleNames:
      mergeCsvLabels(prev.circleNames, next.circleNames) ?? prev.circleNames,
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
    climate: string | null;
    weekIs: string | null;
    dressingFor: string | null;
    kids: string | null;
    styleMix: StyleMix | null;
  } | null;
  sizing: {
    heightCm?: number | null;
    weightKg?: number | null;
    bodyType?: string | null;
    sensitivities?: string[] | null;
    topUsualSize: string | null;
    bottomUsualSize: string | null;
    shoeEU: number | null;
    shoeUS: number | null;
  } | null;
  brandPreferences: Array<{ brand: string; sentiment: string }>;
  hardNegatives: Array<{
    scope: string;
    value: string;
    note?: string | null;
  }>;
  tasteTags: Array<{ tag: string; polarity: string; category?: string | null }>;
};

function profileYouSaved(profile: OnboardingStatus["profile"]): boolean {
  if (!profile) return false;
  return Boolean(
    profile.preferredName?.trim() &&
      profile.genderPresentation?.trim() &&
      (profile.styleEra?.trim() || profile.ageRange?.trim()),
  );
}

function profileLifeSaved(profile: OnboardingStatus["profile"]): boolean {
  if (!profile) return false;
  return Boolean(
    profile.weekIs?.trim() ||
      profile.dressingFor?.trim() ||
      profile.kids?.trim() ||
      profile.climate?.trim(),
  );
}

function resolveResumeStep(
  status: OnboardingStatus,
  restart = false,
): FittingStep {
  if (restart) {
    clearOnboardingUiSession();
    return "photo";
  }
  const sessionStep = readOnboardingUiSession()?.step ?? null;
  if (status.onboarding.completed) {
    return sessionStep ?? "verdict";
  }
  return resolveFittingResumeStep(status, sessionStep);
}

async function fetchSelfPerson(
  signal?: AbortSignal,
): Promise<{ id: string; hasAvatar: boolean; avatarUrl: string | null } | null> {
  try {
    const res = await guestFetch("/api/avatar/people", {
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
  const res = await guestFetch("/api/onboarding", { cache: "no-store", signal });
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

/**
 * Mirror “developing · %” — quiz progress toward a dressed twin.
 * Twin mint starts after fit (height/build); that only advances the body band.
 * 100% is reserved for the final step (verdict / clothes on the avatar).
 */
function developPctFromFlags(flags: {
  identity: boolean;
  life: boolean;
  spend: boolean;
  sizing: boolean;
  photoAccepted: boolean;
  /** Body twin minted — not card-complete. */
  twinReady: boolean;
  wornSaved: boolean;
  wantedSaved: boolean;
  nolistSaved: boolean;
  tasteFinal: boolean;
  circleSaved: boolean;
  /** Final Fitting step. */
  verdict: boolean;
  /** FASHN try-on of a worn style onto the twin. */
  dressed: boolean;
}): number {
  let pct = 4;
  if (flags.identity) pct = 12;
  if (flags.life) pct = Math.max(pct, 17);
  if (flags.spend) pct = Math.max(pct, 22);
  if (flags.sizing) pct = Math.max(pct, 32);
  if (flags.photoAccepted) pct = Math.max(pct, 40);
  // Early mint: body exists; keep room for taste + final dress.
  if (flags.twinReady) pct = Math.max(pct, 48);
  if (flags.wornSaved) pct = Math.max(pct, 58);
  if (flags.wantedSaved) pct = Math.max(pct, 68);
  if (flags.nolistSaved) pct = Math.max(pct, 78);
  if (flags.tasteFinal) pct = Math.max(pct, 84);
  if (flags.circleSaved) pct = Math.max(pct, 90);
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
  const [step, setStep] = useState<FittingStep>("consent");
  const [selfPersonId, setSelfPersonId] = useState<string | null>(null);
  const [holdOpen, setHoldOpen] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const { questions: inlineSlot, card: cardSlot } = useInlineFittingSlots();
  const replayFitting = useInlineFittingStore((s) => s.replayFitting);
  const accessMode = useAppSessionStore((s) => s.mode);
  const identityScope = useClientIdentityScopeKey();
  const accountReady = accessMode === "authenticated" || accessMode === "local";
  const canProcessPhotoRef = useRef(false);
  const [biometricAccepted, setBiometricAccepted] = useState<boolean | null>(
    null,
  );
  const [needsBiometricReconsent, setNeedsBiometricReconsent] = useState(false);
  const [biometricBusy, setBiometricBusy] = useState(false);
  const [biometricError, setBiometricError] = useState<string | null>(null);
  const setOnboardingActive = useInlineFittingStore(
    (s) => s.setOnboardingActive,
  );
  const wasGuestRef = useRef(accessMode === "guest");
  const [flash, setFlash] = useState<{
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
  const wornDeckRef = useRef<OutfitGridCard[]>([]);
  const aspirationalDeckRef = useRef<OutfitGridCard[]>([]);
  const wornPickLabelsRef = useRef<string[]>([]);
  const wornPickTasteTagsRef = useRef<string[]>([]);
  const avatarStartedRef = useRef(false);
  /** Server accepted photo draft (not just local preview). */
  const photoReadyRef = useRef(false);
  const pendingPhotoFileRef = useRef<File | null>(null);
  canProcessPhotoRef.current = biometricAccepted === true;
  const [analysisPhotoFile, setAnalysisPhotoFile] = useState<File | null>(null);
  const [finale, setFinale] = useState<"scan" | "card">("scan");
  const [stylistVerdict, setStylistVerdict] = useState<StylistVerdict | null>(
    null,
  );
  const [scanActivity, setScanActivity] =
    useState<MirrorState["scanActivity"]>("idle");
  const [scanNotes, setScanNotes] = useState<MirrorState["scanNotes"]>([]);
  const handleScanUi = useCallback((ui: ScanUiPayload) => {
    setScanActivity(ui.activity);
    setScanNotes((prev) =>
      JSON.stringify(prev) === JSON.stringify(ui.notes) ? prev : ui.notes,
    );
  }, []);
  /** Prevent double FASHN spend. */
  const mintInFlightRef = useRef(false);
  const mintDoneRef = useRef(false);
  const mintAbortRef = useRef(false);
  const lastMintOptsRef = useRef<{
    personId: string;
    heightCm: number;
    build: BuildBand;
    muscularity: FittingPhotoValues["muscularity"];
    bodyShape: FittingPhotoValues["bodyShape"];
    bustFullness: FittingPhotoValues["bustFullness"];
    includeBust: boolean;
  } | null>(null);
  const twinCreepRef = useRef<number | null>(null);
  const twinCreepStartedAtRef = useRef(0);
  const twinPrintStartedAtRef = useRef(0);
  /** Coalesce concurrent photo attaches (identity save + fit mint). */
  const attachPromiseRef = useRef<Promise<boolean> | null>(null);

  const [preferredName, setPreferredName] = useState("");
  const [genderPresentation, setGenderPresentation] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [birthDateSkipped, setBirthDateSkipped] = useState(false);
  const [styleEras, setStyleEras] = useState<string[]>([]);
  const [storedLifestyleTags, setStoredLifestyleTags] = useState<string[]>([]);
  const [weekIs, setWeekIs] = useState("");
  const [dressingFor, setDressingFor] = useState("");
  const [kids, setKids] = useState("");
  const [climate, setClimate] = useState("");
  const detectedArea = useUserProfileStore((s) => s.detectedArea);
  const profileCompleted = useUserProfileStore((s) => s.onboardingCompleted);
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
  const [comfort, setComfort] = useState<string[]>([]);
  const [honestyPreference, setHonestyPreference] = useState("");
  /** Trusted Circle first-name slots (sparse; up to 3). */
  const [circleNames, setCircleNames] = useState<string[]>(["", "", ""]);
  const [styleMix, setStyleMix] = useState<StyleMix | null>(null);

  const [photoValues, setPhotoValues] = useState<FittingPhotoValues>({
    photoPreview: null,
    photoCoverage: "face",
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
    legLine: null,
  });
  /** Local face preview (object URL) while FASHN twin is generating. */
  const [localFacePreview, setLocalFacePreview] = useState<string | null>(null);
  /** Real mint result / people API avatar_url */
  const [twinAvatarUrl, setTwinAvatarUrl] = useState<string | null>(null);
  const [twinStatus, setTwinStatus] = useState<MirrorState["twinStatus"]>(
    "idle",
  );
  const [twinError, setTwinError] = useState<string | null>(null);
  const [twinBuildPct, setTwinBuildPct] = useState(0);
  const [twinBuildLabel, setTwinBuildLabel] = useState("");
  const [twinBuildElapsedSec, setTwinBuildElapsedSec] = useState(0);
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
    life: false,
    spend: false,
    sizing: false,
    wornSaved: false,
    wantedSaved: false,
    nolistSaved: false,
    tasteFinal: false,
    circleSaved: false,
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

  useEffect(() => {
    return () => {
      if (twinCreepRef.current != null) {
        window.clearInterval(twinCreepRef.current);
        twinCreepRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const apply = (json: {
      accepted?: boolean;
      needsReconsent?: boolean;
    }) => {
      if (cancelled) return;
      setBiometricAccepted(Boolean(json.accepted));
      setNeedsBiometricReconsent(Boolean(json.needsReconsent));
    };
    void guestFetch("/api/privacy/biometric-consent", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return;
        apply((await res.json()) as { accepted?: boolean; needsReconsent?: boolean });
      })
      .catch(() => undefined);
    const onConsent = (event: Event) => {
      const accepted = (event as CustomEvent<{ accepted?: boolean }>).detail
        ?.accepted;
      if (typeof accepted === "boolean") {
        setBiometricAccepted(accepted);
        if (accepted) setNeedsBiometricReconsent(false);
      }
    };
    window.addEventListener(BIOMETRIC_CONSENT_EVENT, onConsent);
    return () => {
      cancelled = true;
      window.removeEventListener(BIOMETRIC_CONSENT_EVENT, onConsent);
    };
  }, [identityScope]);

  useEffect(() => {
    if (step !== "consent") return;
    if (biometricAccepted !== true || needsBiometricReconsent) return;
    setStep("photo");
  }, [step, biometricAccepted, needsBiometricReconsent]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const file =
        getPendingFittingPhoto() ?? (await loadPersistedFittingPhoto());
      if (!file || cancelled) return;
      pendingPhotoFileRef.current = file;
      setPendingFittingPhoto(file);
      setAnalysisPhotoFile(file);
      const preview = URL.createObjectURL(file);
      if (cancelled) {
        URL.revokeObjectURL(preview);
        return;
      }
      setPhotoValues((p) => ({ ...p, photoPreview: preview }));
      setLocalFacePreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return preview;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Only when identity context *content* changes — not new array refs from hydrate. */
  const outfitDeckContextKey = [
    genderPresentation.trim().toLowerCase(),
    joinCsvValues(styleEras),
    joinCsvValues(budgetPhilosophies),
    weekIs,
    kids,
  ].join("|");

  useEffect(() => {
    wornDeckRef.current = wornDeck;
  }, [wornDeck]);

  useEffect(() => {
    aspirationalDeckRef.current = aspirationalDeck;
  }, [aspirationalDeck]);

  useEffect(() => {
    setWornDeck([]);
    setAspirationalDeck([]);
    setWornPicks([]);
    setAspirationalPicks([]);
    setClosetImages([]);
    setWornHasMore(false);
    setAspirationalHasMore(false);
    wornDeckRef.current = [];
    aspirationalDeckRef.current = [];
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
    if (prefill.comfort) {
      setComfort((prev) =>
        mergeLabelLists(
          prev,
          prefill.comfort!
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
        ),
      );
    }
    if (prefill.weekIs) setWeekIs(prefill.weekIs);
    if (prefill.dressingFor) setDressingFor(prefill.dressingFor);
    if (prefill.kids) setKids(prefill.kids);
    if (prefill.climate) {
      setClimate(normalizeClimate(prefill.climate) || prefill.climate);
    }
    if (prefill.honestyPreference) {
      setHonestyPreference(
        normalizeHonestyPreference(prefill.honestyPreference) ||
          prefill.honestyPreference,
      );
    }
    if (prefill.circleNames) {
      const parsed = prefill.circleNames
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
        .slice(0, 3);
      if (parsed.length) {
        setCircleNames([
          parsed[0] ?? "",
          parsed[1] ?? "",
          parsed[2] ?? "",
        ]);
      }
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
      life:
        f.life ||
        Boolean(
          prefill.weekIs?.trim() ||
            prefill.dressingFor?.trim() ||
            prefill.kids?.trim() ||
            prefill.climate?.trim(),
        ),
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
            prefill.hardAvoids?.trim() ||
            prefill.comfort?.trim(),
        ),
      tasteFinal: f.tasteFinal || Boolean(prefill.honestyPreference?.trim()),
      circleSaved:
        f.circleSaved || Boolean(prefill.circleNames?.trim()),
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
        const vetoes = next.hardNegatives
          .filter((h) => h.note !== "comfort" && !isComfortConstraint(h.value))
          .map((h) => h.value);
        if (vetoes.length) {
          setHardAvoids((prev) => mergeLabelLists(prev, vetoes));
        }
        const comfortFromNegatives = next.hardNegatives
          .filter((h) => h.note === "comfort" || isComfortConstraint(h.value))
          .map((h) => h.value);
        if (comfortFromNegatives.length) {
          setComfort((prev) => mergeLabelLists(prev, comfortFromNegatives));
        }
      }
      if (next.sizing?.sensitivities?.length) {
        setComfort((prev) =>
          mergeLabelLists(prev, next.sizing!.sensitivities!),
        );
      }
      if (next.profile?.weekIs?.trim()) setWeekIs(next.profile.weekIs.trim());
      if (next.profile?.dressingFor?.trim()) {
        setDressingFor(next.profile.dressingFor.trim());
      }
      if (next.profile?.kids?.trim()) setKids(next.profile.kids.trim());
      if (next.profile?.climate?.trim()) {
        setClimate(
          normalizeClimate(next.profile.climate) || next.profile.climate.trim(),
        );
      }
      if (next.profile?.lifestyleTags?.length) {
        setStoredLifestyleTags((prev) =>
          mergeLabelLists(prev, next.profile!.lifestyleTags!),
        );
      }
      if (next.profile?.honestyPreference) {
        setHonestyPreference(
          normalizeHonestyPreference(next.profile.honestyPreference) ||
            next.profile.honestyPreference,
        );
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
        life: prev.life || profileLifeSaved(next.profile),
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

  useLayoutEffect(() => {
    const session = readOnboardingUiSession();
    if (!session || session.dismissed) return;
    useInlineFittingStore.getState().resumeColumn();
    setStep(session.step);
    if (session.step === "verdict") setHoldOpen(true);
    if (session.finale === "scan") setFinale("scan");
    else if (session.finale && session.step !== "verdict") {
      setFinale(session.finale);
    }
    if (session.circleNames?.some((n) => n.trim())) {
      setCircleNames(session.circleNames);
    }
  }, []);

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

        const restart =
          useInlineFittingStore.getState().replayFitting &&
          next.onboarding.completed;
        const session = readOnboardingUiSession();
        const resume = resolveResumeStep(next, restart);
        setStep(resume);
        if (resume === "verdict" && session?.finale === "scan") {
          setFinale("scan");
        }
        if (!session?.dismissed && (session || !next.onboarding.completed)) {
          writeOnboardingUiSession({
            step: resume,
            finale: resume === "verdict" ? session?.finale : undefined,
          });
          useInlineFittingStore.getState().resumeColumn();
          if (next.onboarding.completed || resume === "verdict") {
            setHoldOpen(true);
          }
        }
        if (session?.circleNames?.some((n) => n.trim())) {
          setCircleNames(session.circleNames);
        }
        const self = await fetchSelfPerson(ctrl.signal);
        if (self) {
          setSelfPersonId(self.id);
          if (self.hasAvatar && self.avatarUrl) {
            setTwinAvatarUrl(self.avatarUrl);
            setTwinStatus("ready");
            setTwinError(null);
            setTwinBuildPct(100);
            setTwinBuildLabel("");
            setTwinBuildElapsedSec(0);
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
  }, [hydrateFromStatus, detectedArea, identityScope]);

  useEffect(() => {
    if (loading || !status) return;
    const session = readOnboardingUiSession();
    if (session?.dismissed) return;
    writeOnboardingUiSession({ step, circleNames, finale });
  }, [loading, status, step, circleNames, finale]);

  const replayWasOn = useRef(false);
  useEffect(() => {
    if (!replayFitting) {
      replayWasOn.current = false;
      return;
    }
    if (loading || !status) return;
    if (replayWasOn.current) return;
    replayWasOn.current = true;
    if (!status.onboarding.completed) return;
    clearOnboardingUiSession();
    setStep("photo");
    setFinale("scan");
    setStylistVerdict(null);
  }, [replayFitting, loading, status]);

  const lifestyleTags = useMemo(() => {
    const derived = lifestyleTagsFromLife({ weekIs, kids });
    return derived.length ? derived : storedLifestyleTags;
  }, [weekIs, kids, storedLifestyleTags]);

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

  const lifeValues = useMemo<TasteLifeValues>(
    () => ({ weekIs, dressingFor, kids, climate }),
    [weekIs, dressingFor, kids, climate],
  );

  const lifeOnChange = useCallback(
    <K extends keyof TasteLifeValues>(key: K, value: TasteLifeValues[K]) => {
      switch (key) {
        case "weekIs":
          setWeekIs(value);
          break;
        case "dressingFor":
          setDressingFor(value);
          break;
        case "kids":
          setKids(value);
          break;
        case "climate":
          setClimate(value);
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
      if (
        key === "photoCoverage" &&
        pendingPhotoFileRef.current &&
        canProcessPhotoRef.current
      ) {
        kickPhotoAnalysis(pendingPhotoFileRef.current, {
          coverage: value as PhotoCoverage,
        });
      }
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
      const deckRef = mode === "worn" ? wornDeckRef : aspirationalDeckRef;
      const currentDeck = deckRef.current;
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
        const res = await guestFetch(`/api/onboarding/taste?${params}`, {
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
          const seen = new Set(currentDeck.map((c) => c.id));
          const added = next.filter((c) => c.id && !seen.has(c.id));
          setDeck((prev) => {
            const prevSeen = new Set(prev.map((c) => c.id));
            return [
              ...prev,
              ...added.filter((c) => c.id && !prevSeen.has(c.id)),
            ];
          });
          // Prefer server flag; never keep "See more" if this page added nothing.
          const serverHasMore = json.hasMore;
          setHasMore(
            added.length === 0
              ? false
              : typeof serverHasMore === "boolean"
                ? serverHasMore
                : added.length >= 9,
          );
        } else {
          setDeck(next);
          const serverHasMore = json.hasMore;
          setHasMore(
            typeof serverHasMore === "boolean"
              ? serverHasMore
              : next.length >= 9,
          );
        }
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
    ],
  );

  useEffect(() => {
    // Prefetch wardrobe grid while still on spend/fit so worn isn't blocked.
    if (
      (step === "spend" || step === "fit" || step === "worn") &&
      wornDeck.length === 0
    ) {
      void loadOutfitDeck("worn");
    }
  }, [step, wornDeck.length, loadOutfitDeck]);

  useEffect(() => {
    if (step === "wanted" && aspirationalDeck.length === 0) {
      void loadOutfitDeck("aspirational");
    }
  }, [step, aspirationalDeck.length, loadOutfitDeck]);

  useEffect(() => {
    return () => {
      mintAbortRef.current = true;
    };
  }, []);

  // Enter to advance
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      if (step === "verdict" || step === "honesty" || step === "circle" || step === "consent") return;
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
   * Advance after critical save work. No full-screen blocker — CTA `busy`
   * and in-step loaders (outfit grids) carry progress. Optional soft pill
   * only for long finish jobs via showLoading.
   */
  async function runWithLoading(opts: {
    nextStep: FittingStep;
    work: () => Promise<boolean>;
  }): Promise<boolean> {
    setError(null);
    try {
      const ok = await opts.work();
      if (!ok) return false;
      setStep(opts.nextStep);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      return false;
    }
  }

  function showLoading(opts: { status: string; detail: string }) {
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
      !isAtLeastAge(birthDate, MIN_ACCOUNT_AGE)
    ) {
      setError(`You need to be at least ${MIN_ACCOUNT_AGE} to use Shoop.`);
      return false;
    }
    const ageFromDob =
      !birthDateSkipped && birthDate && isAtLeastAge(birthDate, MIN_ACCOUNT_AGE)
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

      const patch = await guestFetch("/api/onboarding/review", {
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
                isAtLeastAge(birthDate, MIN_ACCOUNT_AGE)
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
      const personId =
        patchJson.selfPerson?.id ?? selfPersonId ?? (await ensurePersonId());
      const pending = pendingPhotoFileRef.current;
      if (personId && pending && canProcessPhotoRef.current) {
        void attachAvatarPhoto(personId, pending);
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your profile.");
      return false;
    } finally {
      submissionLockRef.current = false;
      setBusy(false);
    }
  }

  async function saveLife(): Promise<boolean> {
    if (!weekIs && !dressingFor && !kids && !climate) {
      return true;
    }
    if (submissionLockRef.current) return false;
    submissionLockRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const derivedTags = lifestyleTagsFromLife({ weekIs, kids });
      const res = await guestFetch("/api/onboarding/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patch: {
            profile: {
              weekIs: weekIs || null,
              dressingFor: dressingFor || null,
              kids: kids || null,
              climate: climate || null,
              lifestyleTags: derivedTags,
            },
          },
          requestKey: crypto.randomUUID(),
        }),
      });
      const json = (await res.json()) as OnboardingStatus & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Could not save your week.");
      hydrateFromStatus(json);
      setPersistedFlags((f) => ({ ...f, life: true }));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your week.");
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

  async function startAvatarIfNeeded(personId: string): Promise<string | null> {
    if (avatarStartedRef.current) return personId;
    avatarStartedRef.current = true;
    try {
      const res = await guestFetch("/api/avatar/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ person_id: personId }),
      });
      const body = await readAvatarJson(res);
      if (!res.ok || body.error) {
        avatarStartedRef.current = false;
        return null;
      }
      const resolved = body.draft?.person_id ?? personId;
      if (resolved !== personId) setSelfPersonId(resolved);
      return resolved;
    } catch {
      avatarStartedRef.current = false;
      return null;
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

  function stopTwinCreep() {
    if (twinCreepRef.current != null) {
      window.clearInterval(twinCreepRef.current);
      twinCreepRef.current = null;
    }
    twinPrintStartedAtRef.current = 0;
  }

  function setTwinStage(pct: number, label: string) {
    setTwinBuildPct((p) => Math.max(p, pct));
    setTwinBuildLabel(label);
  }

  /** Ticking clock from mint start; print-phase bar asymptotes at 92%. */
  function ensureTwinClock() {
    if (twinCreepRef.current != null) return;
    twinCreepStartedAtRef.current = Date.now();
    twinCreepRef.current = window.setInterval(() => {
      const elapsed = Date.now() - twinCreepStartedAtRef.current;
      setTwinBuildElapsedSec(Math.floor(elapsed / 1000));
      const printAt = twinPrintStartedAtRef.current;
      if (!printAt) return;
      const printElapsed = Date.now() - printAt;
      const t = printElapsed / TWIN_PRINT_EXPECTED_MS;
      const curved = Math.min(
        92,
        Math.round(52 + (1 - Math.exp(-1.4 * t)) * 40),
      );
      setTwinBuildPct((p) => Math.max(p, curved));
      setTwinBuildLabel(
        printElapsed > 40_000
          ? "almost there — still printing"
          : printElapsed > 18_000
            ? "rendering your twin"
            : "printing — about a minute",
      );
    }, 450);
  }

  function startTwinPrintCreep() {
    ensureTwinClock();
    twinPrintStartedAtRef.current = Date.now();
  }

  /**
   * Start the FASHN twin during the quiz, fire-and-forget:
   * measurements → check (intake merge) → attributes → FASHN generate → poll → approve.
   * Sends every body-related AvatarAttributes field we have so the prompt is complete.
   */
  async function kickBackgroundMint(
    opts: {
      personId: string;
      heightCm: number;
      build: BuildBand;
      muscularity: FittingPhotoValues["muscularity"];
      bodyShape: FittingPhotoValues["bodyShape"];
      bustFullness: FittingPhotoValues["bustFullness"];
      includeBust: boolean;
    },
    retryPass = 0,
  ) {
    lastMintOptsRef.current = opts;
    if (mintDoneRef.current || mintInFlightRef.current) return;
    if (!photoReadyRef.current) return;

    mintInFlightRef.current = true;
    setTwinStatus("developing");
    setTwinError(null);
    ensureTwinClock();
    setTwinStage(14, "reading your photo");

    try {
      const personId =
        (await startAvatarIfNeeded(opts.personId)) ?? opts.personId;
      setTwinStage(22, "sketching your silhouette");

      let attrs = buildFittingAvatarAttributes({
        heightCm: opts.heightCm,
        build: opts.build,
        muscularity: opts.muscularity,
        bodyShape: opts.bodyShape,
        bustFullness: opts.bustFullness,
        includeBust: opts.includeBust,
      });

      const measRes = await guestFetchWithRetry("/api/avatar/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "measurements",
          person_id: personId,
          measurements: [
            { metric: "height", value: opts.heightCm, unit: "cm" },
          ],
        }),
      });
      const measBody = await readAvatarJson(measRes);
      if (!measRes.ok || measBody.error) {
        if (isRateLimitedResponse(measRes, measBody.error)) {
          throw Object.assign(
            new Error(
              measBody.error ?? "Too many requests. Please slow down.",
            ),
            { rateLimited: true as const, response: measRes },
          );
        }
        throw new Error(measBody.error ?? "Could not save your height.");
      }
      setTwinStage(30, "sketching your silhouette");

      // Re-check merges photo intake suggestions (e.g. body_shape) under stated attrs.
      const checkRes = await guestFetchWithRetry("/api/avatar/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "check",
          person_id: personId,
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
      setTwinStage(38, "locking your shape");

      const attrRes = await guestFetchWithRetry("/api/avatar/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "attributes",
          person_id: personId,
          attributes: attrs,
        }),
      });
      const attrBody = await readAvatarJson(attrRes);
      if (!attrRes.ok || attrBody.error) {
        if (isRateLimitedResponse(attrRes, attrBody.error)) {
          throw Object.assign(
            new Error(
              attrBody.error ?? "Too many requests. Please slow down.",
            ),
            { rateLimited: true as const, response: attrRes },
          );
        }
        throw new Error(attrBody.error ?? "Could not save your measurements.");
      }
      setTwinStage(48, "locking your shape");

      setTwinStage(52, "printing — about a minute");
      startTwinPrintCreep();
      const genRes = await guestFetchWithRetry("/api/avatar/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          person_id: personId,
          action: "generate",
          attributes: attrs,
        }),
      });
      const genBody = await readAvatarJson(genRes);
      if (!genRes.ok || genBody.error) {
        if (isRateLimitedResponse(genRes, genBody.error)) {
          throw Object.assign(
            new Error(genBody.error ?? "Too many requests. Please slow down."),
            { rateLimited: true as const, response: genRes },
          );
        }
        throw new Error(genBody.error ?? "Twin generation failed.");
      }

      let preview: string | null = genBody.draft?.preview_url ?? null;
      if (genBody.draft?.compare && genBody.draft.compare_job_id) {
        preview = await pollAvatarJob(
          personId,
          genBody.draft.compare_job_id,
          Date.now(),
        );
      }

      if (!preview) {
        throw new Error("Twin mint produced no preview image.");
      }

      stopTwinCreep();
      setTwinStage(94, "finishing");

      const approveRes = await guestFetchWithRetry("/api/avatar/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          person_id: personId,
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
      stopTwinCreep();
      setTwinBuildPct(100);
      setTwinBuildLabel("");
      setTwinAvatarUrl(finalUrl);
      setTwinStatus("ready");
      setTwinError(null);
      useSelfAvatarStore.getState().markReady(finalUrl);
      void useSelfAvatarStore.getState().refresh();
    } catch (e) {
      const rateLimited =
        e instanceof Error &&
        "rateLimited" in e &&
        (e as { rateLimited?: boolean }).rateLimited === true;
      const res =
        e instanceof Error && "response" in e
          ? (e as { response?: Response }).response
          : undefined;

      if (rateLimited && retryPass < 1) {
        const wait = res ? retryAfterMs(res, retryPass) : 5_000;
        twinPrintStartedAtRef.current = 0;
        setTwinBuildLabel("waiting to retry");
        setTwinError("Busy building your twin — retrying in a moment…");
        setTwinStatus("developing");
        window.setTimeout(() => {
          void kickBackgroundMint(opts, retryPass + 1);
        }, wait);
        return;
      }

      const msg = rateLimited
        ? "Too many photo requests just now — finish the quiz and we'll retry from Mirror."
        : userFacingTwinMintError(e);
      console.error("[shoop] background twin mint failed", e);
      stopTwinCreep();
      setTwinError(msg);
      setTwinStatus("error");
    } finally {
      mintInFlightRef.current = false;
    }
  }

  function retryTwinMint() {
    if (mintInFlightRef.current) return;
    mintDoneRef.current = false;
    mintAbortRef.current = false;
    const stored = lastMintOptsRef.current;
    const personId = stored?.personId ?? selfPersonId;
    const heightCm = stored?.heightCm ?? heightCmFromPhoto(photoValues);
    if (!personId || heightCm == null) return;
    void kickBackgroundMint({
      personId,
      heightCm,
      build: (photoValues.build ?? stored?.build ?? "average") as BuildBand,
      muscularity: photoValues.muscularity ?? stored?.muscularity ?? null,
      bodyShape: photoValues.bodyShape ?? stored?.bodyShape ?? null,
      bustFullness: photoValues.bustFullness ?? stored?.bustFullness ?? null,
      includeBust: normalizeGender(genderPresentation) === "feminine",
    });
  }

  function buildDeclaredStyleContext(): Record<string, unknown> {
    const ctx: Record<string, unknown> = {};
    if (genderPresentation.trim()) {
      ctx.gender_presentation = genderPresentation.trim();
    }
    if (!birthDateSkipped) {
      const age = ageYearsFromBirthDate(birthDate);
      if (age != null) ctx.age = age;
    }
    if (persistedFlags.identity && shippingCountry.trim()) {
      ctx.location = shippingCountry.trim();
    }
    if (persistedFlags.sizing) {
      ctx.height_cm = heightCmFromPhoto(photoValues);
    }
    const weightKg = weightKgFromPhoto(photoValues);
    if (weightKg != null) ctx.weight_kg = weightKg;
    if (photoValues.legLine) ctx.torso_to_leg = photoValues.legLine;
    ctx.requested_coverage = photoValues.photoCoverage;
    if (dressingFor.trim()) ctx.goal = dressingFor.trim();
    if (weekIs.trim()) ctx.week_is = weekIs.trim();
    if (climate.trim()) ctx.climate = climate.trim();
    return ctx;
  }

  function kickPhotoAnalysis(
    file: File,
    opts?: { force?: boolean; coverage?: PhotoCoverage },
  ) {
    const coverage = opts?.coverage ?? photoValues.photoCoverage;
    const form = new FormData();
    fillPhotoAnalysisForm(form, {
      photo: file,
      declaredContext: {
        ...buildDeclaredStyleContext(),
        requested_coverage: coverage,
      },
      requestedCoverage: coverage,
    });
    const path = opts?.force
      ? "/api/onboarding/photo-analysis?force=1"
      : "/api/onboarding/photo-analysis";
    void guestFetch(path, {
      method: "POST",
      body: form,
    }).catch(() => {
      /* panel polls GET; analysis never blocks onboarding */
    });
  }

  async function attachAvatarPhoto(personId: string, file: File): Promise<boolean> {
    if (photoReadyRef.current) return true;
    if (attachPromiseRef.current) return attachPromiseRef.current;

    const run = (async (): Promise<boolean> => {
      const resolvedId = (await startAvatarIfNeeded(personId)) ?? personId;
      try {
        const form = new FormData();
        form.append("person_id", resolvedId);
        form.append("photo", file);
        const res = await guestFetch("/api/avatar/upload", {
          method: "POST",
          body: form,
        });
        const body = await readAvatarJson(res);
        if (!res.ok || body.error) {
          setError(body.error ?? "Could not upload photo. Try another.");
          return false;
        }
        if (body.draft?.step === "refused_minor") {
          setError(
            body.draft.intake?.refusal_message ?? "We can't use this photo.",
          );
          photoReadyRef.current = false;
          return false;
        }

        const checkRes = await guestFetchWithRetry("/api/avatar/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "check", person_id: resolvedId }),
        });
        const checkBody = await readAvatarJson(checkRes);
        if (checkBody.draft?.step === "refused_minor") {
          setError(
            checkBody.draft.intake?.refusal_message ??
              "We can't use this photo.",
          );
          photoReadyRef.current = false;
          return false;
        }

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
        return true;
      } catch {
        setError("Upload failed — try another photo.");
        return false;
      } finally {
        attachPromiseRef.current = null;
      }
    })();

    attachPromiseRef.current = run;
    return run;
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
    stopTwinCreep();
    setTwinBuildPct(0);
    setTwinBuildLabel("");
    setTwinBuildElapsedSec(0);
    photoReadyRef.current = false;
    mintDoneRef.current = false;
    pendingPhotoFileRef.current = file;
    setPendingFittingPhoto(file);
    setAnalysisPhotoFile(file);
    if (canProcessPhotoRef.current) {
      kickPhotoAnalysis(file);
    }
    void advanceFrom("photo");
  }

  useEffect(() => {
    if (!canProcessPhotoRef.current) return;
    const file = pendingPhotoFileRef.current ?? getPendingFittingPhoto();
    if (!file || photoReadyRef.current) return;
    kickPhotoAnalysis(file);
  }, [accountReady, biometricAccepted]);

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
      const res = await guestFetch("/api/onboarding/review", {
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

      const patch = await guestFetch("/api/onboarding/review", {
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

      // Start twin mint as soon as fit numbers land — never block the quiz on
      // photo attach or FASHN. Mirror shows developing immediately.
      const pending = pendingPhotoFileRef.current;
      const mintOpts = {
        personId,
        heightCm,
        build,
        muscularity: photoValues.muscularity,
        bodyShape: photoValues.bodyShape,
        bustFullness: photoValues.bustFullness,
        includeBust: normalizeGender(genderPresentation) === "feminine",
      };
      const prevMint = lastMintOptsRef.current;
      const silhouetteChanged =
        prevMint != null &&
        silhouetteMintKey(prevMint) !== silhouetteMintKey(mintOpts);
      if (silhouetteChanged) {
        mintDoneRef.current = false;
        setTwinAvatarUrl(null);
      }
      const canMint =
        canProcessPhotoRef.current &&
        Boolean(personId) &&
        (photoReadyRef.current || Boolean(pending)) &&
        !mintDoneRef.current;
      if (canMint && personId) {
        setTwinStatus("developing");
        setTwinError(null);
        ensureTwinClock();
        setTwinStage(8, "uploading your photo");
        void (async () => {
          if (!photoReadyRef.current && pending) {
            const attached = await attachAvatarPhoto(personId, pending);
            if (!attached && !photoReadyRef.current) {
              stopTwinCreep();
              setTwinStatus("error");
              setTwinError("Could not upload your photo for the twin.");
              return;
            }
          }
          if (photoReadyRef.current) {
            void kickBackgroundMint({ ...mintOpts, personId });
          }
        })();
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

  async function persistScanBody(): Promise<boolean> {
    try {
      const heightCm = heightCmFromPhoto(photoValues);
      const weightKg = weightKgFromPhoto(photoValues);
      const sizing: Record<string, unknown> = {
        heightCm,
        bodyType: photoValues.build ?? "average",
      };
      if (weightKg != null) sizing.weightKg = weightKg;
      const res = await guestFetch("/api/onboarding/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patch: { sizing },
          requestKey: crypto.randomUUID(),
        }),
      });
      return res.ok;
    } catch {
      return false;
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
      const res = await guestFetch("/api/onboarding/taste", {
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
          comfort,
          compliments: [],
          honestyPreference:
            normalizeHonestyPreference(honestyPreference) || null,
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
          brandLikes.length +
            brandAvoids.length +
            hardAvoids.length +
            comfort.length >
            0,
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

  async function saveCircle(): Promise<boolean> {
    if (submissionLockRef.current) return false;
    submissionLockRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const names = circleNames.map((n) => n.trim()).filter(Boolean);
      if (!accountReady) {
        setPersistedFlags((f) => ({ ...f, circleSaved: true }));
        return true;
      }
      const res = await guestFetch("/api/onboarding/circle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names }),
      });
      const json = (await res.json()) as {
        error?: string;
        names?: string[];
      };
      if (!res.ok) {
        throw new Error(json.error ?? "Could not save your trusted circle.");
      }
      if (json.names?.length) {
        setCircleNames([
          json.names[0] ?? "",
          json.names[1] ?? "",
          json.names[2] ?? "",
        ]);
      }
      setPersistedFlags((f) => ({ ...f, circleSaved: true }));
      return true;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save your trusted circle.",
      );
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
      status: "finishing your print…",
      detail: mintInFlightRef.current
        ? "Waiting on your twin, then wrapping up…"
        : "Saving final state…",
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

      if (accountReady && circleNames.some((n) => n.trim())) {
        submissionLockRef.current = false;
        const circleOk = await saveCircle();
        submissionLockRef.current = true;
        if (!circleOk) {
          throw new Error("Could not save your trusted circle.");
        }
      }

      const res = await guestFetch("/api/onboarding", { method: "POST" });
      const next = (await res.json()) as OnboardingStatus & { error?: string };
      useInlineFittingStore.getState().clearReplay();
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
      if (twinAvatarUrl) useSelfAvatarStore.getState().markReady(twinAvatarUrl);
      void useSelfAvatarStore.getState().refresh();
      clearOnboardingUiSession();
      clearGuestPhotoLive();
      setHoldOpen(false);
      useInlineFittingStore.getState().dismissColumn();
      useInlineFittingStore.getState().setOnboardingActive(false);
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
    if (current === "consent") {
      setStep("photo");
      return;
    }
    if (current === "photo") {
      setStep("name");
      return;
    }
    if (current === "name") {
      await runWithLoading({
        nextStep: "life",
        work: () => saveIdentity(),
      });
      return;
    }
    if (current === "life") {
      await runWithLoading({
        nextStep: "spend",
        work: () => saveLife(),
      });
      return;
    }
    if (current === "spend") {
      await runWithLoading({
        nextStep: "fit",
        work: () => saveSpend(),
      });
      return;
    }
    if (current === "fit") {
      await runWithLoading({
        nextStep: "worn",
        work: async () => {
          const ok = await savePhotoAndAttrs();
          if (!ok) return false;
          // Deck loads on the worn step (and may already be prefetching).
          void loadOutfitDeck("worn");
          return true;
        },
      });
      return;
    }
    if (current === "worn") {
      await runWithLoading({
        nextStep: "wanted",
        work: async () => {
          const ok = await saveTaste(false, "worn");
          if (!ok) return false;
          void loadOutfitDeck("aspirational");
          return true;
        },
      });
      return;
    }
    if (current === "wanted") {
      await runWithLoading({
        nextStep: "nolist",
        work: () => saveTaste(false, "wanted"),
      });
      return;
    }
    if (current === "nolist") {
      await runWithLoading({
        nextStep: "honesty",
        work: () => saveTaste(false, "nolist"),
      });
      return;
    }
    if (current === "honesty") {
      await runWithLoading({
        nextStep: "circle",
        work: async () => {
          const ok = await saveTaste(false, "final");
          if (!ok) return false;
          return true;
        },
      });
      return;
    }
    if (current === "circle") {
      await runWithLoading({
        nextStep: "verdict",
        work: async () => {
          const ok = await saveCircle();
          if (!ok) return false;
          setHoldOpen(true);
          return true;
        },
      });
    }
  }

  function goBack() {
    setError(null);
    if (
      step === "verdict" &&
      finale === "card" &&
      photoValues.photoPreview
    ) {
      setFinale("scan");
      return;
    }
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
      const res = await guestFetch("/api/onboarding/fitting-tell", {
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
            comfort: comfort.length ? comfort : undefined,
            weekIs: weekIs || undefined,
            dressingFor: dressingFor || undefined,
            kids: kids || undefined,
            climate: climate || undefined,
            honestyPreference: honestyPreference || undefined,
            circleNames: circleNames.map((n) => n.trim()).filter(Boolean),
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
          comfort?: string[];
          weekIs?: string;
          dressingFor?: string;
          kids?: string;
          climate?: string;
          honestyPreference?: string;
          circleNames?: string[];
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
        setTellFeedback(json.error ?? "Couldn't catch that — try again.");
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
        comfort:
          json.extraction?.comfort?.join(", ") ?? json.prefill?.comfort,
        weekIs: json.extraction?.weekIs ?? json.prefill?.weekIs,
        dressingFor: json.extraction?.dressingFor ?? json.prefill?.dressingFor,
        kids: json.extraction?.kids ?? json.prefill?.kids,
        climate: json.extraction?.climate ?? json.prefill?.climate,
        budgetPhilosophy:
          json.extraction?.budgetPhilosophies?.join(",") ??
          json.prefill?.budgetPhilosophy,
        honestyPreference:
          normalizeHonestyPreference(
            json.extraction?.honestyPreference ??
              json.prefill?.honestyPreference,
          ) || undefined,
        circleNames:
          json.extraction?.circleNames?.join(", ") ??
          json.prefill?.circleNames,
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
    life: persistedFlags.life || profileLifeSaved(status?.profile ?? null),
    spend:
      persistedFlags.spend || Boolean(status?.profile?.valuePhilosophy?.trim()),
    sizing: persistedFlags.sizing || Boolean(status?.sizing?.heightCm),
    photoAccepted: photoReadyRef.current || Boolean(localFacePreview),
    twinReady: twinStatus === "ready" && Boolean(twinAvatarUrl),
    wornSaved: persistedFlags.wornSaved,
    wantedSaved: persistedFlags.wantedSaved,
    nolistSaved: persistedFlags.nolistSaved,
    tasteFinal: persistedFlags.tasteFinal,
    circleSaved: persistedFlags.circleSaved,
    verdict: step === "verdict",
    dressed: dressStatus === "ready" && Boolean(dressedAvatarUrl),
  });

  /**
   * Verdict scan vs card follows the server job, not a first-paint photo URL.
   * A running verdict keeps the scan UI after reload; only a finished verdict
   * (or a skipped scan) locks the card.
   */
  useEffect(() => {
    if (step !== "verdict") return;
    let cancelled = false;

    void (async () => {
      try {
        const res = await guestFetch("/api/onboarding/photo-analysis", {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as {
          analysis: PhotoAnalysisPublic | null;
        };
        if (cancelled) return;
        if (!json.analysis) {
          setFinale("card");
          return;
        }
        const phase = photoScanPhase(json.analysis);
        if (phase === "done" && json.analysis?.verdict) {
          setStylistVerdict(json.analysis.verdict);
          setFinale("card");
          writeOnboardingUiSession({ step: "verdict", finale: "card" });
          return;
        }
        if (
          phase === "writing" ||
          phase === "reading" ||
          phase === "review"
        ) {
          setFinale("scan");
          writeOnboardingUiSession({ step: "verdict", finale: "scan" });
          return;
        }
        setFinale("card");
      } catch {
        if (!cancelled) setFinale("scan");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [step]);

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
        const res = await guestFetch("/api/tryon/fitting-room", {
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
          const pollRes = await guestFetch(
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
      circleLabel: circleMirrorLabel(circleNames),
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
      legLine: photoValues.legLine,
      form: formFromGender(genderPresentation),
      developPct,
      twinStatus,
      twinError,
      twinBuildPct,
      twinBuildLabel,
      twinBuildElapsedSec,
      dressStatus,
      dressError,
      dressStyleLabel,
      closetImages,
      serial: selfPersonId ? printSerialFromId(selfPersonId) : "——",
      foil:
        step === "verdict" &&
        twinStatus === "ready" &&
        dressStatus === "ready",
      scanActivity,
      scanNotes,
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
    circleNames,
    localFacePreview,
    twinAvatarUrl,
    dressedAvatarUrl,
    photoValues,
    genderPresentation,
    developPct,
    twinStatus,
    twinError,
    twinBuildPct,
    twinBuildLabel,
    twinBuildElapsedSec,
    dressStatus,
    dressError,
    dressStyleLabel,
    closetImages,
    selfPersonId,
    step,
    scanActivity,
    scanNotes,
  ]);

  const incomplete =
    replayFitting ||
    (profileCompleted !== true &&
      (holdOpen ||
        Boolean(status?.onboarding && !status.onboarding.completed)));

  useLayoutEffect(() => {
    if (loading) return;
    setOnboardingActive(incomplete);
  }, [incomplete, loading, setOnboardingActive]);

  useEffect(() => {
    const wasGuest = wasGuestRef.current;
    wasGuestRef.current = accessMode === "guest";
    if (!wasGuest || accessMode !== "authenticated") return;
    if (step !== "verdict") return;
    void completeOnboarding();
  }, [accessMode, step]);

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
      ? { n: FITTING_Q_STEPS.length, stage: "THE FITTING" }
      : STEP_META[step];

  const pickFacePhoto =
    step === "photo"
      ? (file: File) => {
          photoOnChange("photoCoverage", "face");
          void uploadPhoto(file);
        }
      : undefined;

  const mirrorPane = (
    <FittingMirror
      layout="column"
      mirror={mirror}
      onTell={step === "verdict" ? undefined : handleTell}
      tellFeedback={tellFeedback}
      tellBusy={tellBusy}
      onPickPhoto={pickFacePhoto}
      photoPickLocked={biometricAccepted !== true}
      onRetryTwin={
        twinStatus === "error" ? retryTwinMint : undefined
      }
    />
  );

  if (!inlineSlot) return null;

  if (loading) {
    return (
      <>
        {createPortal(
          <div className="relative flex h-full min-h-[280px] flex-col px-1 py-5">
            <div className="mb-8 h-2.5 w-20 animate-pulse rounded-full bg-[#E9E9EE]" />
            <div className="mb-3 h-9 max-w-[16rem] animate-pulse rounded-lg bg-[#E9E9EE]" />
            <div className="mb-2 h-9 max-w-[12rem] animate-pulse rounded-lg bg-[#E9E9EE]" />
            <div className="mt-4 h-3 max-w-[18rem] animate-pulse rounded-full bg-[#F0F0F3]" />
            <FittingFlash
              show
              layout="column"
              statusLabel="loading your print…"
              detail="Fetching your profile…"
            />
          </div>,
          inlineSlot,
        )}
        {cardSlot ? createPortal(mirrorPane, cardSlot) : null}
      </>
    );
  }

  if (
    (!status?.onboarding || status.onboarding.completed) &&
    !holdOpen &&
    !replayFitting
  ) {
    return null;
  }

  const fitting = (
    <div className="relative h-full min-h-0">
      <FittingFlash
        show={Boolean(flash)}
        layout="column"
        statusLabel={flash?.status ?? ""}
        detail={flash?.detail ?? null}
      />
      <FittingShell
        layout="column"
        step={step}
        progressPct={progressPct}
        stageLabel={
          step === "verdict" ? "THE FITTING" : stepMeta.stage
        }
        stepCountLabel={
          step === "verdict"
            ? "DONE"
            : `${stepMeta.n} of ${FITTING_Q_STEPS.length}`
        }
        mirror={mirror}
        onTell={handleTell}
        tellFeedback={tellFeedback}
        tellBusy={tellBusy}
        onPickPhoto={pickFacePhoto}
        photoPickLocked={biometricAccepted !== true}
        onRetryTwin={
          twinStatus === "error" ? retryTwinMint : undefined
        }
      >
        {step !== "consent" && step !== "photo" && (step !== "verdict" || finale === "scan") ? (
          <FittingBackLink onClick={goBack} />
        ) : null}
        {step !== "verdict" ? (
          <FittingCount n={stepMeta.n} total={FITTING_Q_STEPS.length} />
        ) : null}

        {step === "consent" ? (
          <FittingConsentStep
            guest={!accountReady}
            busy={biometricBusy}
            error={biometricError}
            onContinue={(ticks) => {
              void (async () => {
                setBiometricBusy(true);
                setBiometricError(null);
                try {
                  const res = await guestFetch(
                    "/api/privacy/biometric-consent",
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        action: "accept",
                        ...ticks,
                      }),
                    },
                  );
                  const json = (await res.json()) as { error?: string };
                  if (!res.ok) {
                    setBiometricError(json.error ?? "Could not save consent.");
                    return;
                  }
                  setBiometricAccepted(true);
                  notifyBiometricConsent(true);
                  if (!accountReady) markGuestPhotoLive();
                  void advanceFrom("consent");
                } finally {
                  setBiometricBusy(false);
                }
              })();
            }}
          />
        ) : null}

        {step === "photo" ? (
          <FittingPhotoStep
            mode="scan"
            values={photoValues}
            onChange={photoOnChange}
            onPhotoFile={(f) => {
              photoOnChange("photoCoverage", "face");
              void uploadPhoto(f);
            }}
            onSkipPhoto={() => {
              photoReadyRef.current = false;
              pendingPhotoFileRef.current = null;
              setPendingFittingPhoto(null);
              setAnalysisPhotoFile(null);
              void advanceFrom("photo");
            }}
            onContinue={() => void advanceFrom("photo")}
            busy={busy}
            showContinue
          />
        ) : null}

        {needsBiometricReconsent &&
        biometricAccepted === false &&
        (step === "photo" || Boolean(photoValues.photoPreview)) ? (
          <BiometricConsentSheet
            busy={biometricBusy}
            error={biometricError}
            skipLabel="skip... continue without a photo"
            onSkip={() => {
              photoReadyRef.current = false;
              pendingPhotoFileRef.current = null;
              setPendingFittingPhoto(null);
              setAnalysisPhotoFile(null);
              if (step === "photo") void advanceFrom("photo");
            }}
            onAccept={async () => {
              setBiometricBusy(true);
              setBiometricError(null);
              try {
                const res = await guestFetch(
                  "/api/privacy/biometric-consent",
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "accept" }),
                  },
                );
                const json = (await res.json()) as { error?: string };
                if (!res.ok) {
                  setBiometricError(json.error ?? "Could not save consent.");
                  return;
                }
                setBiometricAccepted(true);
                notifyBiometricConsent(true);
              } finally {
                setBiometricBusy(false);
              }
            }}
          />
        ) : null}

        {step === "name" ? (
          <YouIdentityStep
            values={identityValues}
            onChange={identityOnChange}
            onContinue={() => void advanceFrom("name")}
            busy={busy}
          />
        ) : null}

        {step === "life" ? (
          <TasteLifeStep
            values={lifeValues}
            onChange={lifeOnChange}
            onContinue={() => void advanceFrom("life")}
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

        {step === "fit" ? (
          <FittingPhotoStep
            mode="body"
            values={photoValues}
            onChange={photoOnChange}
            onSkipPhoto={() => {
              photoReadyRef.current = false;
              void advanceFrom("fit");
            }}
            onContinue={() => void advanceFrom("fit")}
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
              climate,
              build: photoValues.build ?? undefined,
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
            comfort={comfort}
            onChangeBrandLikes={setBrandLikes}
            onChangeBrandAvoids={setBrandAvoids}
            onChangeHardAvoids={setHardAvoids}
            onChangeComfort={setComfort}
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

        {step === "circle" ? (
          <TasteCircleStep
            names={circleNames}
            onChange={setCircleNames}
            onContinue={() => void advanceFrom("circle")}
            onSkip={() => {
              void (async () => {
                setCircleNames(["", "", ""]);
                await runWithLoading({
                  nextStep: "verdict",
                  work: async () => {
                    if (!accountReady) {
                      setPersistedFlags((f) => ({ ...f, circleSaved: true }));
                      setHoldOpen(true);
                      return true;
                    }
                    // Persist empty circle (skip) without racing setState.
                    if (submissionLockRef.current) return false;
                    submissionLockRef.current = true;
                    setBusy(true);
                    setError(null);
                    try {
                      const res = await guestFetch("/api/onboarding/circle", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ names: [] }),
                      });
                      if (!res.ok) {
                        const json = (await res.json()) as { error?: string };
                        throw new Error(
                          json.error ?? "Could not skip trusted circle.",
                        );
                      }
                      setPersistedFlags((f) => ({ ...f, circleSaved: true }));
                      setHoldOpen(true);
                      return true;
                    } catch (e) {
                      setError(
                        e instanceof Error
                          ? e.message
                          : "Could not skip trusted circle.",
                      );
                      return false;
                    } finally {
                      submissionLockRef.current = false;
                      setBusy(false);
                    }
                  },
                });
              })();
            }}
            busy={busy}
          />
        ) : null}

        {step === "verdict" &&
        finale === "scan" &&
        biometricAccepted === true ? (
          <FittingAnalysisPanel
            enabled
            photoFile={analysisPhotoFile}
            photoPreview={photoValues.photoPreview}
            requestedCoverage="face"
            body={photoValues}
            onBodyChange={photoOnChange}
            onPersistBody={() => persistScanBody()}
            onScanUi={handleScanUi}
            onComplete={(row) => {
              setStylistVerdict(row.verdict);
              setFinale("card");
              writeOnboardingUiSession({ step: "verdict", finale: "card" });
              handleScanUi({ activity: "idle", notes: [] });
            }}
            onSkip={() => {
              setFinale("card");
              writeOnboardingUiSession({ step: "verdict", finale: "card" });
              handleScanUi({ activity: "idle", notes: [] });
            }}
          />
        ) : null}

        {step === "verdict" &&
        (finale === "card" || biometricAccepted !== true) ? (
          <FittingVerdictStep
            preferredName={preferredName}
            wornLabels={wornPicks.map((p) => p.label)}
            stealLabels={aspirationalPicks.map((p) => p.label)}
            leanLabel={mirror.leanLabel}
            form={mirror.form}
            build={photoValues.build}
            vetoCount={hardAvoids.length + brandAvoids.length + comfort.length}
            verdict={stylistVerdict}
            styleMix={styleMix}
            developPct={mirror.developPct}
            circleNames={circleNames.map((n) => n.trim()).filter(Boolean)}
            dressStatus={dressStatus}
            dressStyleLabel={dressStyleLabel}
            busy={busy}
            ctaLabel={
              accountReady ? undefined : "Save your progress and log in"
            }
            onMeetTwin={() => {
              if (!accountReady) {
                openAuthModal("signup");
                return;
              }
              void completeOnboarding();
            }}
            shareCopied={shareCopied}
            onShare={(selectedCircle) => {
              const circleBit = selectedCircle.length
                ? ` Asking ${selectedCircle.join(", ")}.`
                : "";
              const face = stylistVerdict?.user_facing_verdict;
              const text = face?.opening
                ? `${face.title ? `${face.title}. ` : ""}${face.opening} www.shoop.world`
                : `My Shoop verdict: I love ${wornPicks.map((p) => p.label).join(", ") || "comfort"}, drawn to ${aspirationalPicks.map((p) => p.label).join(", ") || "more"}. ${hardAvoids.length + brandAvoids.length} hard vetoes.${circleBit} www.shoop.world`;
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
            Continue
          </button>
        ) : null}
      </FittingShell>
    </div>
  );

  return (
    <>
      {createPortal(fitting, inlineSlot)}
      {cardSlot ? createPortal(mirrorPane, cardSlot) : null}
    </>
  );
}
