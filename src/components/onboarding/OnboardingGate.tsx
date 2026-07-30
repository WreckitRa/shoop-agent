"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AiProfileTransferStep,
  type AiTransferPhase,
} from "@/components/onboarding/AiProfileTransferStep";
import {
  CARD_FORGE_STEP_META,
  CardForgeStep,
  cardForgeCopy,
  type CardForgeSubstep,
} from "@/components/onboarding/CardForgeStep";
import { OnboardingDoorwayStep } from "@/components/onboarding/OnboardingDoorwayStep";
import { OnboardingLoadingPanel } from "@/components/onboarding/OnboardingLoadingPanel";
import { TasteComplimentStep } from "@/components/onboarding/TasteComplimentStep";
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
  YouLocationSizesStep,
  type YouLocationValues,
} from "@/components/onboarding/YouLocationSizesStep";
import { useSelfAvatarStore } from "@/components/tryon/self-avatar-store";
import {
  isPrimaryAiAssistantId,
  type PrimaryAiAssistantId,
} from "@/lib/onboarding/ai-transfer-prompts";
import {
  DEFAULT_CITY,
  DEFAULT_CURRENCY,
  DEFAULT_SHIPPING_COUNTRY,
  ageYearsFromBirthDate,
  currencyHintForCountry,
  joinCsvValues,
  isAtLeastAge,
  normalizeAgeRange,
  normalizeGender,
  parseCsvValues,
  styleEraToAgeRange,
} from "@/lib/onboarding/form-options";
import type { StyleMix } from "@/lib/onboarding/style-mix";
import { useUserProfileStore } from "@/lib/client/user-profile-store";

type OnboardingPrefill = {
  preferredName?: string;
  genderPresentation?: string;
  ageRange?: string;
  shippingCountry?: string;
  currency?: string;
  topSize?: string;
  bottomSize?: string;
  shoeEU?: string;
  budgetPhilosophy?: string;
  brandLikes?: string;
  brandAvoids?: string;
  hardAvoids?: string;
};

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
    primaryAiAssistant: string | null;
    styleEra: string | null;
    honestyPreference: string | null;
    complimentPreferences: string[] | null;
    lifestyleTags: string[] | null;
    styleMix: StyleMix | null;
  } | null;
  sizing: {
    topUsualSize: string | null;
    bottomUsualSize: string | null;
    shoeEU: number | null;
    shoeUS: number | null;
  } | null;
  brandPreferences: Array<{ brand: string; sentiment: string }>;
  hardNegatives: Array<{ scope: string; value: string }>;
  tasteTags: Array<{ tag: string; polarity: string; category?: string | null }>;
};

const RAIL_STEPS = [
  { id: "you", label: "Who you are" },
  { id: "taste", label: "What's your taste" },
  { id: "card", label: "Your card" },
] as const;

type RailStepId = (typeof RAIL_STEPS)[number]["id"];
type FlowStep = "doorway" | "intake" | RailStepId;

type TasteSubstep =
  | "spend"
  | "worn"
  | "aspirational"
  | "loves"
  | "compliments"
  | "honesty";

const TASTE_SUBSTEPS: TasteSubstep[] = [
  "spend",
  "worn",
  "aspirational",
  "loves",
  "compliments",
  "honesty",
];

const CARD_FORGE_ORDER: CardForgeSubstep[] = [
  "photo",
  "height",
  "build",
  "definition",
  "mint",
  "reveal",
];

const ONBOARDING_UI_SESSION_KEY = "shoop.onboarding.ui.v1";

type OnboardingUiSession = {
  step: FlowStep;
  youSubstep: 0 | 1;
  tasteSubstep: TasteSubstep;
  cardSubstep: CardForgeSubstep;
};

type ResumePosition = OnboardingUiSession;

function isTasteSubstep(v: unknown): v is TasteSubstep {
  return typeof v === "string" && (TASTE_SUBSTEPS as string[]).includes(v);
}

function isCardSubstep(v: unknown): v is CardForgeSubstep {
  return typeof v === "string" && (CARD_FORGE_ORDER as string[]).includes(v);
}

function isFlowStep(v: unknown): v is FlowStep {
  return (
    v === "doorway" ||
    v === "intake" ||
    v === "you" ||
    v === "taste" ||
    v === "card"
  );
}

function readOnboardingUiSession(): OnboardingUiSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(ONBOARDING_UI_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OnboardingUiSession>;
    if (!isFlowStep(parsed.step)) return null;
    return {
      step: parsed.step,
      youSubstep: parsed.youSubstep === 1 ? 1 : 0,
      tasteSubstep: isTasteSubstep(parsed.tasteSubstep)
        ? parsed.tasteSubstep
        : "spend",
      cardSubstep: isCardSubstep(parsed.cardSubstep)
        ? parsed.cardSubstep
        : "photo",
    };
  } catch {
    return null;
  }
}

function writeOnboardingUiSession(pos: OnboardingUiSession) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(ONBOARDING_UI_SESSION_KEY, JSON.stringify(pos));
  } catch {
    /* ignore quota / private mode */
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

/** Server floor — never resume past what was actually persisted. */
function resumeFloorFromStatus(status: OnboardingStatus): ResumePosition {
  if (!status.onboarding.started) {
    return {
      step: "doorway",
      youSubstep: 0,
      tasteSubstep: "spend",
      cardSubstep: "photo",
    };
  }

  if (profileTasteSaved(status)) {
    return {
      step: "card",
      youSubstep: 1,
      tasteSubstep: "honesty",
      cardSubstep: "photo",
    };
  }

  if (profileYouSaved(status.profile)) {
    return {
      step: "taste",
      youSubstep: 1,
      tasteSubstep: "spend",
      cardSubstep: "photo",
    };
  }

  const identityDone = Boolean(
    status.profile?.preferredName?.trim() &&
      status.profile?.genderPresentation?.trim() &&
      status.profile?.styleEra?.trim(),
  );

  return {
    step: "you",
    youSubstep: identityDone ? 1 : 0,
    tasteSubstep: "spend",
    cardSubstep: "photo",
  };
}

const FLOW_RANK: Record<FlowStep, number> = {
  doorway: 0,
  intake: 1,
  you: 2,
  taste: 3,
  card: 4,
};

/**
 * Merge session UI (mid-taste / card forge) with the server floor.
 * Session may advance within the unlocked rail step; never past what the server allows.
 */
function resolveResumePosition(status: OnboardingStatus): ResumePosition {
  const floor = resumeFloorFromStatus(status);
  if (status.onboarding.completed) {
    clearOnboardingUiSession();
    return floor;
  }

  const session = readOnboardingUiSession();
  if (!session) return floor;

  if (FLOW_RANK[session.step] < FLOW_RANK[floor.step]) {
    return floor;
  }

  if (floor.step === "card") {
    if (session.step === "card") {
      const sIdx = CARD_FORGE_ORDER.indexOf(session.cardSubstep);
      const fIdx = CARD_FORGE_ORDER.indexOf(floor.cardSubstep);
      return {
        step: "card",
        youSubstep: 1,
        tasteSubstep: "honesty",
        cardSubstep:
          CARD_FORGE_ORDER[Math.max(sIdx, fIdx)] ?? floor.cardSubstep,
      };
    }
    return floor;
  }

  if (floor.step === "taste") {
    if (session.step === "taste") {
      const sIdx = TASTE_SUBSTEPS.indexOf(session.tasteSubstep);
      const fIdx = TASTE_SUBSTEPS.indexOf(floor.tasteSubstep);
      return {
        step: "taste",
        youSubstep: 1,
        tasteSubstep:
          TASTE_SUBSTEPS[Math.max(sIdx, fIdx)] ?? floor.tasteSubstep,
        cardSubstep: "photo",
      };
    }
    // Stale session still on card before taste was re-saved — stay on taste
    return floor;
  }

  if (floor.step === "you" && session.step === "you") {
    return {
      ...floor,
      youSubstep: Math.max(session.youSubstep, floor.youSubstep) as 0 | 1,
    };
  }

  return floor;
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
/**
 * Ordered milestones for the whole onboarding flow.
 * Identity / location / spend advance within the same step as each answer lands.
 */
const FLOW_PROGRESS_KEYS = [
  "doorway",
  "intake",
  "you:name",
  "you:gender",
  "you:dob",
  "you:era",
  "you:world",
  "you:country",
  "you:city",
  "you:sizes",
  "taste:spend",
  "taste:worn",
  "taste:aspirational",
  "taste:loves",
  "taste:compliments",
  "taste:honesty",
  "card:photo",
  "card:height",
  "card:build",
  "card:definition",
  "card:mint",
  "card:reveal",
] as const;

type FlowProgressKey = (typeof FLOW_PROGRESS_KEYS)[number];

const PRE_CARD_PROGRESS_KEYS = FLOW_PROGRESS_KEYS.filter(
  (k) => !k.startsWith("card:"),
);
const CARD_PROGRESS_KEYS = FLOW_PROGRESS_KEYS.filter((k) =>
  k.startsWith("card:"),
);

/** Share of the bar reserved for Your card (photo → reveal). */
const CARD_PROGRESS_START_PCT = 58;

/**
 * Ease-out through taste, then a clear climb through Your card.
 * Early steps still jump quickly; card forge owns the last ~42%.
 */
function exponentialProgressPercent(
  key: FlowProgressKey,
  power = 2.35,
): number {
  if (key.startsWith("card:")) {
    const idx = CARD_PROGRESS_KEYS.indexOf(
      key as (typeof CARD_PROGRESS_KEYS)[number],
    );
    if (idx < 0) return CARD_PROGRESS_START_PCT;
    const t = (idx + 1) / CARD_PROGRESS_KEYS.length;
    return Math.round(
      CARD_PROGRESS_START_PCT + t * (100 - CARD_PROGRESS_START_PCT),
    );
  }

  const idx = PRE_CARD_PROGRESS_KEYS.indexOf(
    key as (typeof PRE_CARD_PROGRESS_KEYS)[number],
  );
  if (idx <= 0) return 4;
  const last = PRE_CARD_PROGRESS_KEYS.length - 1;
  if (idx >= last) return CARD_PROGRESS_START_PCT;
  const t = idx / last;
  return Math.round(
    4 + (1 - Math.pow(1 - t, power)) * (CARD_PROGRESS_START_PCT - 4),
  );
}

function furthestProgressKey(
  keys: FlowProgressKey[],
): FlowProgressKey {
  let best: FlowProgressKey = "doorway";
  let bestIdx = -1;
  for (const key of keys) {
    const idx = FLOW_PROGRESS_KEYS.indexOf(key);
    if (idx > bestIdx) {
      bestIdx = idx;
      best = key;
    }
  }
  return best;
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function birthDateToInput(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
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

export function OnboardingGate() {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<FlowStep>("doorway");
  const [youSubstep, setYouSubstep] = useState<0 | 1>(0);
  const [tasteSubstep, setTasteSubstep] = useState<TasteSubstep>("spend");
  const [cardSubstep, setCardSubstep] = useState<CardForgeSubstep>("photo");
  const [selfPersonId, setSelfPersonId] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [editingLocation, setEditingLocation] = useState(false);
  /** Keep modal mounted through welcome beat after onboarding completes. */
  const [holdOpenForWelcome, setHoldOpenForWelcome] = useState(false);
  const submissionLockRef = useRef(false);
  const reviewRequestKeyRef = useRef<string | null>(null);
  const wornDeckInFlightRef = useRef(false);
  const aspirationalDeckInFlightRef = useRef(false);
  /** Labels only — avoids recreating loadOutfitDeck when picks change. */
  const wornPickLabelsRef = useRef<string[]>([]);
  const wornPickTasteTagsRef = useRef<string[]>([]);

  const [intakeText, setIntakeText] = useState("");
  const [intakePhase, setIntakePhase] = useState<AiTransferPhase>("select");
  const [selectedAi, setSelectedAi] = useState<PrimaryAiAssistantId | "">("");

  const [preferredName, setPreferredName] = useState("");
  const [genderPresentation, setGenderPresentation] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [birthDateSkipped, setBirthDateSkipped] = useState(false);
  const [styleEras, setStyleEras] = useState<string[]>([]);
  const [lifestyleTags, setLifestyleTags] = useState<string[]>([]);

  const [city, setCity] = useState(DEFAULT_CITY);
  const [shippingCountry, setShippingCountry] = useState(
    DEFAULT_SHIPPING_COUNTRY,
  );
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
  const [topSize, setTopSize] = useState("");
  const [bottomSize, setBottomSize] = useState("");
  const [shoeEU, setShoeEU] = useState("");
  const [locationConfirmed, setLocationConfirmed] = useState(true);

  const [budgetPhilosophies, setBudgetPhilosophies] = useState<string[]>([]);
  const [wornDeck, setWornDeck] = useState<OutfitGridCard[]>([]);
  const [aspirationalDeck, setAspirationalDeck] = useState<OutfitGridCard[]>(
    [],
  );
  const [wornLoading, setWornLoading] = useState(false);
  const [aspirationalLoading, setAspirationalLoading] = useState(false);
  const [wornPicks, setWornPicks] = useState<OutfitGridCard[]>([]);
  const [aspirationalPicks, setAspirationalPicks] = useState<OutfitGridCard[]>(
    [],
  );

  useEffect(() => {
    wornPickLabelsRef.current = wornPicks.map((p) => p.label);
    wornPickTasteTagsRef.current = wornPicks.flatMap((p) => p.tasteTags ?? []);
  }, [wornPicks]);
  const [brandLikes, setBrandLikes] = useState<string[]>([]);
  const [brandAvoids, setBrandAvoids] = useState<string[]>([]);
  const [hardAvoids, setHardAvoids] = useState<string[]>([]);
  const [compliments, setCompliments] = useState<string[]>([]);
  const [honestyPreference, setHonestyPreference] = useState("");
  const [styleMix, setStyleMix] = useState<StyleMix | null>(null);

  const detectedArea = useUserProfileStore((s) => s.detectedArea);
  const suggestedLabel = useMemo(() => {
    if (!detectedArea) return null;
    const parts = [detectedArea.cityLabel, detectedArea.countryLabel].filter(
      Boolean,
    );
    return parts.length ? parts.join(", ") : null;
  }, [detectedArea]);

  const applyPrefill = useCallback((prefill: OnboardingPrefill) => {
    if (prefill.preferredName) setPreferredName(prefill.preferredName);
    if (prefill.genderPresentation) {
      setGenderPresentation(normalizeGender(prefill.genderPresentation));
    }
    if (prefill.shippingCountry) {
      setShippingCountry(prefill.shippingCountry);
      setLocationConfirmed(true);
    }
    if (prefill.currency) setCurrency(prefill.currency);
    if (prefill.topSize) setTopSize(prefill.topSize);
    if (prefill.bottomSize) setBottomSize(prefill.bottomSize);
    if (prefill.shoeEU) setShoeEU(prefill.shoeEU);
    if (prefill.budgetPhilosophy) {
      setBudgetPhilosophies(parseCsvValues(prefill.budgetPhilosophy));
    }
    if (prefill.brandLikes) setBrandLikes(splitCsv(prefill.brandLikes));
    if (prefill.brandAvoids) setBrandAvoids(splitCsv(prefill.brandAvoids));
    if (prefill.hardAvoids) setHardAvoids(splitCsv(prefill.hardAvoids));
  }, []);

  const hydrateFromStatus = useCallback(
    (next: OnboardingStatus, prefill?: OnboardingPrefill) => {
      setStatus(next);
      setPreferredName(next.profile?.preferredName ?? "");
      setGenderPresentation(normalizeGender(next.profile?.genderPresentation));
      setBirthDate(birthDateToInput(next.profile?.birthDate));
      setStyleEras(parseCsvValues(next.profile?.styleEra));
      setLifestyleTags(next.profile?.lifestyleTags ?? []);
      setCity(next.profile?.city?.trim() || DEFAULT_CITY);
      setShippingCountry(
        next.profile?.shippingCountry?.trim() ||
          next.profile?.country?.trim() ||
          DEFAULT_SHIPPING_COUNTRY,
      );
      setCurrency(next.profile?.currency?.trim() || DEFAULT_CURRENCY);
      setLocationConfirmed(true);
      setTopSize(next.sizing?.topUsualSize ?? "");
      setBottomSize(next.sizing?.bottomUsualSize ?? "");
      setShoeEU(
        next.sizing?.shoeEU != null
          ? String(next.sizing.shoeEU)
          : next.sizing?.shoeUS != null
            ? String(next.sizing.shoeUS)
            : "",
      );
      // Don't wipe taste fields that may only exist in local/prefill state until
      // the taste step persists them (saveYou would otherwise clear spend habit).
      if (next.profile?.valuePhilosophy) {
        setBudgetPhilosophies(parseCsvValues(next.profile.valuePhilosophy));
      }
      const likedBrands = next.brandPreferences
        .filter((b) => b.sentiment === "love" || b.sentiment === "like")
        .map((b) => b.brand);
      if (likedBrands.length) setBrandLikes(likedBrands);
      const avoidedBrands = next.brandPreferences
        .filter((b) => b.sentiment === "avoid" || b.sentiment === "hate")
        .map((b) => b.brand);
      if (avoidedBrands.length) setBrandAvoids(avoidedBrands);
      if (next.hardNegatives.length) {
        setHardAvoids(next.hardNegatives.map((h) => h.value));
      }
      if (next.profile?.complimentPreferences?.length) {
        setCompliments(next.profile.complimentPreferences);
      }
      if (next.profile?.honestyPreference) {
        setHonestyPreference(next.profile.honestyPreference);
      }
      if (next.profile?.styleMix) setStyleMix(next.profile.styleMix);
      const ai = next.profile?.primaryAiAssistant ?? "";
      if (ai && isPrimaryAiAssistantId(ai)) {
        setSelectedAi(ai);
        setIntakePhase("paste");
      }
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

        const resume = resolveResumePosition(next);
        setStep(resume.step);
        setYouSubstep(resume.youSubstep);
        setTasteSubstep(resume.tasteSubstep);
        setCardSubstep(resume.cardSubstep);
        writeOnboardingUiSession(resume);

        if (resume.step === "card" || resume.step === "taste") {
          const self = await fetchSelfPerson(ctrl.signal);
          if (ctrl.signal.aborted || !self) return;
          setSelfPersonId(self.id);
          if (resume.step === "card" && self.hasAvatar) {
            // Already minted — land on reveal, never re-spend a FASHN credit
            setCardSubstep("reveal");
            writeOnboardingUiSession({
              ...resume,
              cardSubstep: "reveal",
            });
            if (self.avatarUrl) {
              useSelfAvatarStore.getState().markReady(self.avatarUrl);
            }
          }
        }
      } catch {
        if (!ctrl.signal.aborted) setError("Could not load onboarding.");
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    })();
    return () => ctrl.abort();
  }, [hydrateFromStatus]);

  // Persist UI position so refresh resumes mid-taste / card forge.
  useEffect(() => {
    if (loading || !status || status.onboarding.completed) return;
    writeOnboardingUiSession({
      step,
      youSubstep,
      tasteSubstep,
      cardSubstep,
    });
  }, [loading, status, step, youSubstep, tasteSubstep, cardSubstep]);
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

  const locationValues = useMemo<YouLocationValues>(
    () => ({
      city,
      shippingCountry,
      currency,
      topSize,
      bottomSize,
      shoeEU,
      locationConfirmed: locationConfirmed && !editingLocation,
    }),
    [
      city,
      shippingCountry,
      currency,
      topSize,
      bottomSize,
      shoeEU,
      locationConfirmed,
      editingLocation,
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
          setLifestyleTags(value as string[]);
          break;
      }
    },
    [],
  );

  const locationOnChange = useCallback(
    <K extends keyof YouLocationValues>(
      key: K,
      value: YouLocationValues[K],
    ) => {
      switch (key) {
        case "city":
          setCity(value as string);
          break;
        case "shippingCountry":
          setShippingCountry(value as string);
          break;
        case "currency":
          setCurrency(value as string);
          break;
        case "topSize":
          setTopSize(value as string);
          break;
        case "bottomSize":
          setBottomSize(value as string);
          break;
        case "shoeEU":
          setShoeEU(value as string);
          break;
        case "locationConfirmed":
          setLocationConfirmed(value as boolean);
          break;
      }
    },
    [],
  );

  const loadOutfitDeck = useCallback(
    async (mode: "worn" | "aspirational") => {
      const inFlight =
        mode === "worn" ? wornDeckInFlightRef : aspirationalDeckInFlightRef;
      if (inFlight.current) return;
      inFlight.current = true;
      const setLoading =
        mode === "worn" ? setWornLoading : setAspirationalLoading;
      const setDeck = mode === "worn" ? setWornDeck : setAspirationalDeck;
      setLoading(true);
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
        if (budgetPhilosophies.length) {
          params.set("valuePhilosophy", joinCsvValues(budgetPhilosophies));
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
        const res = await fetch(`/api/onboarding/taste?${params}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error("deck");
        const json = (await res.json()) as { deck: OutfitGridCard[] };
        // New live deck — never carry selections from a previous run/fetch.
        if (mode === "worn") setWornPicks([]);
        else setAspirationalPicks([]);
        setDeck(json.deck ?? []);
      } catch {
        if (mode === "worn") setWornPicks([]);
        else setAspirationalPicks([]);
        setDeck([]);
      } finally {
        inFlight.current = false;
        setLoading(false);
      }
    },
    [
      genderPresentation,
      styleEras,
      lifestyleTags,
      budgetPhilosophies,
      brandLikes,
      brandAvoids,
      shippingCountry,
      currency,
    ],
  );

  async function submitIntake() {
    if (!intakeText.trim()) {
      setStep("you");
      setYouSubstep(0);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: intakeText }),
      });
      if (!res.ok) throw new Error("extract");
      const next = (await res.json()) as OnboardingStatus;
      hydrateFromStatus(next, next.prefill);
      setStep("you");
      setYouSubstep(0);
    } catch {
      setError(
        "We couldn't read that just yet — no worries, you can fill in the form yourself.",
      );
      setStep("you");
      setYouSubstep(0);
    } finally {
      setBusy(false);
    }
  }

  async function saveYouAndContinue() {
    if (submissionLockRef.current) return;
    const missing: string[] = [];
    if (!preferredName.trim()) missing.push("name");
    if (!genderPresentation.trim()) missing.push("clothing style");
    const styleEraWire = joinCsvValues(styleEras);
    const ageFromDob =
      !birthDateSkipped && birthDate && isAtLeastAge(birthDate, 13)
        ? ageYearsFromBirthDate(birthDate)
        : null;
    const ageRange =
      ageFromDob != null
        ? normalizeAgeRange(String(ageFromDob))
        : styleEraToAgeRange(styleEraWire);
    if (!styleEraWire || !ageRange) missing.push("style era");
    if (missing.length) {
      setError(`Almost there — just add your ${missing.join(" and ")}.`);
      return;
    }

    submissionLockRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const sizing: Record<string, unknown> = {};
      if (topSize.trim()) sizing.topUsualSize = topSize.trim();
      if (bottomSize.trim()) sizing.bottomUsualSize = bottomSize.trim();
      if (shoeEU.trim()) sizing.shoeEU = Number(shoeEU);

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
              ageRange,
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
              ...(selectedAi ? { primaryAiAssistant: selectedAi } : {}),
            },
            ...(Object.keys(sizing).length ? { sizing } : {}),
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
      setStep("taste");
      setTasteSubstep("spend");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your profile.");
    } finally {
      submissionLockRef.current = false;
      setBusy(false);
    }
  }

  async function saveTasteAndGoToAvatar() {
    if (submissionLockRef.current) return;
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
            productId: p.productId,
            archetype: p.archetype,
          })),
          aspirationalPicks: aspirationalPicks.map((p) => ({
            id: p.id,
            label: p.label,
            tasteTags: p.tasteTags,
            productTitle: p.title,
            productId: p.productId,
            archetype: p.archetype,
          })),
          brandLikes,
          brandAvoids,
          hardAvoids,
          compliments,
          honestyPreference: honestyPreference || null,
          valuePhilosophy: joinCsvValues(budgetPhilosophies) || null,
          complete: false,
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

      if (selfPersonId == null) {
        const self = await fetchSelfPerson();
        if (self) setSelfPersonId(self.id);
      }
      setStep("card");
      setCardSubstep("photo");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your taste.");
    } finally {
      submissionLockRef.current = false;
      setBusy(false);
    }
  }

  const finishCardForge = async () => {
    setError(null);
    useSelfAvatarStore.getState().markReady();
    void useSelfAvatarStore.getState().refresh();
    setAvatarBusy(false);
    setHoldOpenForWelcome(true);
    await completeOnboarding();
  };

  const dismissAfterWelcome = () => {
    setHoldOpenForWelcome(false);
  };

  async function completeOnboarding() {
    if (submissionLockRef.current) {
      throw new Error("Already finishing…");
    }
    submissionLockRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding", { method: "POST" });
      const next = (await res.json()) as OnboardingStatus & { error?: string };
      if (!res.ok) {
        // Fallback: complete via taste with complete:true
        const tasteRes = await fetch("/api/onboarding/taste", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            wornPicks: wornPicks.map((p) => ({
              id: p.id,
              label: p.label,
              tasteTags: p.tasteTags,
              archetype: p.archetype,
            })),
            aspirationalPicks: aspirationalPicks.map((p) => ({
              id: p.id,
              label: p.label,
              tasteTags: p.tasteTags,
              archetype: p.archetype,
            })),
            brandLikes,
            brandAvoids,
            hardAvoids,
            compliments,
            honestyPreference: honestyPreference || null,
            valuePhilosophy: joinCsvValues(budgetPhilosophies) || null,
            complete: true,
          }),
        });
        const tasteJson = (await tasteRes.json()) as OnboardingStatus & {
          error?: string;
        };
        if (!tasteRes.ok) {
          throw new Error(
            tasteJson.error ?? next.error ?? "Could not finish onboarding.",
          );
        }
        hydrateFromStatus(tasteJson);
      } else {
        hydrateFromStatus(next);
      }
      useUserProfileStore.getState().setOnboardingCompleted(true);
      void useUserProfileStore.getState().hydrate({ force: true });
      clearOnboardingUiSession();
    } catch (e) {
      setHoldOpenForWelcome(false);
      setError(e instanceof Error ? e.message : "Could not finish onboarding.");
      throw e;
    } finally {
      submissionLockRef.current = false;
      setBusy(false);
    }
  }

  function goBack() {
    setError(null);
    if (avatarBusy) return;
    if (step === "card") {
      if (cardSubstep === "reveal" || cardSubstep === "mint") {
        setCardSubstep("definition");
        return;
      }
      const order = CARD_FORGE_ORDER;
      const idx = order.indexOf(cardSubstep);
      if (idx > 0) {
        setCardSubstep(order[idx - 1]!);
        return;
      }
      setStep("taste");
      setTasteSubstep("honesty");
      return;
    }
    if (step === "taste") {
      const idx = TASTE_SUBSTEPS.indexOf(tasteSubstep);
      if (idx > 0) {
        setTasteSubstep(TASTE_SUBSTEPS[idx - 1]!);
        return;
      }
      setStep("you");
      setYouSubstep(1);
      return;
    }
    if (step === "you") {
      if (youSubstep === 1) {
        setYouSubstep(0);
        return;
      }
      setStep("doorway");
      return;
    }
    if (step === "intake") {
      if (intakePhase === "paste") setIntakePhase("select");
      else setStep("doorway");
    }
  }

  async function advance() {
    setError(null);
    if (step === "you") {
      if (youSubstep === 0) {
        if (!preferredName.trim()) {
          setError(
            "Only your name is truly required... the rest is up to you.",
          );
          return;
        }
        if (
          birthDate.trim() &&
          !birthDateSkipped &&
          !isAtLeastAge(birthDate, 13)
        ) {
          setError("You need to be at least 13 to use Shoop.");
          return;
        }
        setYouSubstep(1);
        return;
      }
      await saveYouAndContinue();
      return;
    }
    if (step === "taste") {
      const idx = TASTE_SUBSTEPS.indexOf(tasteSubstep);
      if (tasteSubstep === "spend") {
        // ok to skip spend
      }
      if (tasteSubstep === "worn") {
        // ok to skip picks
      }
      if (idx < TASTE_SUBSTEPS.length - 1) {
        const next = TASTE_SUBSTEPS[idx + 1]!;
        setTasteSubstep(next);
        return;
      }
      await saveTasteAndGoToAvatar();
    }
  }

  // Reload outfit grids when personalization inputs change (spend habit, etc.).
  // Also clear picks — card ids are live product ids and must not carry over.
  useEffect(() => {
    setWornDeck([]);
    setAspirationalDeck([]);
    setWornPicks([]);
    setAspirationalPicks([]);
    wornDeckInFlightRef.current = false;
    aspirationalDeckInFlightRef.current = false;
  }, [
    budgetPhilosophies,
    genderPresentation,
    styleEras,
    lifestyleTags,
    shippingCountry,
    currency,
    brandLikes,
    brandAvoids,
  ]);

  // Entering a grid step: clear picks + deck so we never show stale
  // selections against a previous live fetch (or hydrated prior answers).
  useEffect(() => {
    if (step === "taste" && tasteSubstep === "worn") {
      setWornPicks([]);
      setWornDeck([]);
      wornDeckInFlightRef.current = false;
    }
  }, [step, tasteSubstep]);

  useEffect(() => {
    if (step === "taste" && tasteSubstep === "aspirational") {
      setAspirationalPicks([]);
      setAspirationalDeck([]);
      aspirationalDeckInFlightRef.current = false;
    }
  }, [step, tasteSubstep]);

  // Load once per grid step — advance() used to also fetch, which doubled
  // catalog fan-out and left slots empty when the deadline hit.
  useEffect(() => {
    if (step === "taste" && tasteSubstep === "worn" && wornDeck.length === 0) {
      void loadOutfitDeck("worn");
    }
  }, [step, tasteSubstep, wornDeck.length, loadOutfitDeck]);

  useEffect(() => {
    if (
      step === "taste" &&
      tasteSubstep === "aspirational" &&
      aspirationalDeck.length === 0
    ) {
      void loadOutfitDeck("aspirational");
    }
  }, [step, tasteSubstep, aspirationalDeck.length, loadOutfitDeck]);

  const progressPercent = useMemo(() => {
    const reached: FlowProgressKey[] = [];

    if (step === "doorway") {
      return exponentialProgressPercent("doorway");
    }
    reached.push("intake");
    if (step === "intake") {
      return exponentialProgressPercent("intake");
    }

    // Identity: each answered field nudges progress on the same step
    const identityAnswered = [
      preferredName.trim(),
      genderPresentation.trim(),
      birthDateSkipped ||
      (birthDate.trim() && isAtLeastAge(birthDate, 13))
        ? "dob"
        : "",
      styleEras.length ? "era" : "",
      lifestyleTags.length ? "world" : "",
    ].filter(Boolean).length;
    const identityKeys: FlowProgressKey[] = [
      "you:name",
      "you:gender",
      "you:dob",
      "you:era",
      "you:world",
    ];
    if (identityAnswered > 0) {
      reached.push(
        identityKeys[Math.min(identityAnswered, identityKeys.length) - 1]!,
      );
    }

    if (step === "you" && youSubstep === 0) {
      return exponentialProgressPercent(furthestProgressKey(reached));
    }

    reached.push("you:world");

    const locationAnswered = [
      shippingCountry.trim(),
      city.trim(),
      topSize.trim() || bottomSize.trim() || shoeEU.trim() ? "sizes" : "",
    ].filter(Boolean).length;
    const locationKeys: FlowProgressKey[] = [
      "you:country",
      "you:city",
      "you:sizes",
    ];
    if (locationAnswered > 0) {
      reached.push(
        locationKeys[Math.min(locationAnswered, locationKeys.length) - 1]!,
      );
    }

    if (step === "you") {
      return exponentialProgressPercent(furthestProgressKey(reached));
    }

    reached.push("you:sizes");

    if (budgetPhilosophies.length) reached.push("taste:spend");

    if (step === "taste") {
      const tasteIdx = TASTE_SUBSTEPS.indexOf(tasteSubstep);
      for (let i = 0; i <= tasteIdx; i++) {
        const sub = TASTE_SUBSTEPS[i]!;
        reached.push(`taste:${sub}`);
      }
      return exponentialProgressPercent(furthestProgressKey(reached));
    }

    reached.push("taste:honesty");

    if (step === "card") {
      const cardKeys: Record<CardForgeSubstep, FlowProgressKey> = {
        photo: "card:photo",
        height: "card:height",
        build: "card:build",
        definition: "card:definition",
        mint: "card:mint",
        reveal: "card:reveal",
      };
      reached.push(cardKeys[cardSubstep]);
      return exponentialProgressPercent(furthestProgressKey(reached));
    }

    return exponentialProgressPercent("card:reveal");
  }, [
    step,
    youSubstep,
    tasteSubstep,
    cardSubstep,
    preferredName,
    genderPresentation,
    birthDate,
    birthDateSkipped,
    styleEras,
    lifestyleTags,
    shippingCountry,
    city,
    topSize,
    bottomSize,
    shoeEU,
    budgetPhilosophies,
  ]);

  if (
    (!status?.onboarding || status.onboarding.completed) &&
    !holdOpenForWelcome
  ) {
    return null;
  }

  const railStep: RailStepId | null =
    step === "doorway" || step === "intake" ? null : (step as RailStepId);

  const header = (() => {
    if (step === "doorway") {
      return {
        eyebrow: "GETTING STARTED",
        title: "Two ways in.",
        subtitle: "Both end the same place: Shoop, knowing you.",
      };
    }
    if (step === "intake") {
      return {
        eyebrow: "GETTING STARTED",
        title: "Import from your AI",
        subtitle:
          intakePhase === "select"
            ? "Which AI do you use? We'll give you a short message to copy."
            : "Copy the message into your AI, then paste what it writes back here.",
      };
    }
    if (step === "you") {
      return {
        eyebrow: "GETTING STARTED",
        title:
          youSubstep === 0
            ? "First things first... what should I call you?"
            : "Where should the good stuff ship?",
        subtitle: null as string | null,
      };
    }
    if (step === "taste") {
      const titles: Record<
        TasteSubstep,
        { title: string; subtitle: string | null }
      > = {
        spend: { title: "How do you like to spend?", subtitle: null },
        worn: {
          title: "Which three did you actually wear most this month?",
          subtitle:
            "Not the fantasy... the reality. No judgment, this is a safe space for that hoodie.",
        },
        aspirational: {
          title: "Whose closet would you steal?",
          subtitle:
            "No guilt... stealing is just wanting with style. Pick two.",
        },
        loves: { title: "Quick vetoes and loyalties.", subtitle: null },
        compliments: {
          title: "What's the compliment you'd love to hear?",
          subtitle: "Pick two.",
        },
        honesty: {
          title: "Last one, and it matters: how honest do you want me?",
          subtitle: null,
        },
      };
      return { eyebrow: "GETTING STARTED", ...titles[tasteSubstep] };
    }
    if (step === "card") {
      const copy = cardForgeCopy(cardSubstep, preferredName);
      return {
        eyebrow: "GETTING STARTED",
        title: copy.title,
        subtitle: copy.subtitle,
      };
    }
    return {
      eyebrow: "GETTING STARTED",
      title: "Your Shoop card",
      subtitle: null,
    };
  })();

  const footerHint = (() => {
    if (step === "you" && youSubstep === 0) {
      return "Only your name is truly required... the rest is up to you.";
    }
    if (step === "you" && youSubstep === 1) {
      return "Skip... I'll grab them at your first checkout.";
    }
    if (step === "card") {
      return "Everything works without a card. Skip anytime and finish later in Settings.";
    }
    return "";
  })();

  const showRail = railStep != null;
  const showPrimaryNext =
    step === "you" ||
    step === "taste" ||
    (step === "intake" && intakePhase === "paste");

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-[22px] border border-hairline bg-white shadow-lift"
      >
        <div
          className={
            showRail
              ? "shrink-0 border-b border-neutral-200 px-6 pb-4 pt-4 sm:px-8"
              : "shrink-0 px-6 pb-2 pt-6 sm:px-8"
          }
        >
          {showRail ? (
            <div className="mb-3 flex items-center justify-center text-[11.5px] text-neutral-400">
              {RAIL_STEPS.map((s, i) => {
                const active = railStep === s.id;
                const activeIdx = RAIL_STEPS.findIndex((x) => x.id === railStep);
                const done = activeIdx > i;
                const lineFilled = activeIdx > i;
                return (
                  <div key={s.id} className="flex items-center">
                    <span
                      className={
                        active
                          ? "shrink-0 font-bold text-brand"
                          : done
                            ? "shrink-0 font-medium text-neutral-500"
                            : "shrink-0"
                      }
                    >
                      <span className="mr-1 align-[2px] text-[8px]">●</span>
                      {s.label}
                    </span>
                    {i < RAIL_STEPS.length - 1 ? (
                      <span
                        className={
                          lineFilled
                            ? "mx-2.5 h-px w-5 shrink-0 bg-brand/45"
                            : "mx-2.5 h-px w-5 shrink-0 bg-neutral-200"
                        }
                        aria-hidden
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          <div
            className={showRail ? "mb-4" : "mb-4 mt-1"}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPercent}
            aria-label="Onboarding progress"
          >
            <div className="flex items-center gap-3">
              <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-neutral-100">
                <div
                  className="h-full rounded-full bg-brand transition-[width] duration-500 ease-out"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <span className="shrink-0 text-[11px] font-semibold tabular-nums text-brand">
                {progressPercent}%
              </span>
            </div>
            {step === "card" && cardSubstep !== "reveal" ? (
              <p className="mt-1.5 text-[10px] font-extrabold tracking-[0.12em] text-neutral-400">
                STEP {CARD_FORGE_STEP_META[cardSubstep].n} OF 5 ·{" "}
                {CARD_FORGE_STEP_META[cardSubstep].label}
                <span className="ml-2 font-semibold tracking-normal text-neutral-500">
                  · Clarity {CARD_FORGE_STEP_META[cardSubstep].clarity}
                </span>
              </p>
            ) : null}
          </div>

          <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-neutral-400">
            {header.eyebrow}
          </p>
          <h2
            id="onboarding-title"
            className="mt-1.5 text-[22px] font-extrabold tracking-tight text-ink"
          >
            {header.title}
          </h2>
          {header.subtitle ? (
            <p className="mt-1.5 max-w-xl text-[13.5px] leading-6 text-neutral-500">
              {header.subtitle}
            </p>
          ) : null}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 sm:px-8">
          {loading || avatarLoading ? (
            <div className="py-16 text-center text-sm text-neutral-500">
              One moment…
            </div>
          ) : step === "doorway" ? (
            <OnboardingDoorwayStep
              onImportAi={() => setStep("intake")}
              onQuickQuiz={() => {
                setStep("you");
                setYouSubstep(0);
              }}
            />
          ) : step === "intake" ? (
            <AiProfileTransferStep
              phase={intakePhase}
              selectedAi={selectedAi}
              intakeText={intakeText}
              onSelectAi={(id) => {
                setSelectedAi(id);
                setIntakePhase("paste");
              }}
              onIntakeChange={setIntakeText}
              onBackToSelect={() => setIntakePhase("select")}
            />
          ) : step === "you" && youSubstep === 0 ? (
            <YouIdentityStep
              values={identityValues}
              onChange={identityOnChange}
            />
          ) : step === "you" ? (
            <YouLocationSizesStep
              values={locationValues}
              suggestedLabel={suggestedLabel}
              onChange={locationOnChange}
              onConfirmSuggested={() => {
                if (detectedArea?.countryLabel) {
                  setShippingCountry(detectedArea.countryLabel);
                  const hint = currencyHintForCountry(
                    detectedArea.countryLabel,
                  );
                  if (hint && !currency) setCurrency(hint);
                }
                if (detectedArea?.cityLabel) setCity(detectedArea.cityLabel);
                setLocationConfirmed(true);
                setEditingLocation(false);
              }}
              onChangeLocation={() => {
                setEditingLocation(true);
                setLocationConfirmed(false);
              }}
            />
          ) : step === "taste" && tasteSubstep === "spend" ? (
            <TasteSpendStep
              values={budgetPhilosophies}
              onChange={setBudgetPhilosophies}
            />
          ) : step === "taste" && tasteSubstep === "worn" ? (
            <TasteOutfitGridStep
              cards={wornDeck}
              selectedIds={wornPicks.map((p) => p.id)}
              maxPicks={3}
              loading={wornLoading}
              onToggle={(card) =>
                setWornPicks((prev) => togglePick(prev, card, 3))
              }
              why="Your real wardrobe is my starting point. The dream comes next."
            />
          ) : step === "taste" && tasteSubstep === "aspirational" ? (
            <TasteOutfitGridStep
              cards={aspirationalDeck}
              selectedIds={aspirationalPicks.map((p) => p.id)}
              maxPicks={2}
              loading={aspirationalLoading}
              onToggle={(card) =>
                setAspirationalPicks((prev) => togglePick(prev, card, 2))
              }
              why="Where you're headed matters as much as where you are. I dress both."
            />
          ) : step === "taste" && tasteSubstep === "loves" ? (
            <TasteLovesVetoesStep
              context={{
                genderPresentation,
                styleEra: joinCsvValues(styleEras),
                lifestyleTags,
                valuePhilosophy: joinCsvValues(budgetPhilosophies),
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
            />
          ) : step === "taste" && tasteSubstep === "compliments" ? (
            <TasteComplimentStep
              values={compliments}
              onChange={setCompliments}
            />
          ) : step === "taste" && tasteSubstep === "honesty" ? (
            <TasteHonestyStep
              value={honestyPreference}
              onChange={setHonestyPreference}
            />
          ) : step === "card" && selfPersonId ? (
            <CardForgeStep
              key={selfPersonId}
              personId={selfPersonId}
              preferredName={preferredName}
              styleEra={joinCsvValues(styleEras)}
              styleMix={styleMix}
              substep={cardSubstep}
              onBusyChange={setAvatarBusy}
              onSubstepChange={setCardSubstep}
              onComplete={() => finishCardForge()}
              onWelcomeDone={dismissAfterWelcome}
              onSkipAll={() => {
                setHoldOpenForWelcome(false);
                void completeOnboarding();
              }}
            />
          ) : step === "card" ? (
            <div className="space-y-4 py-8 text-center">
              <p className="text-sm text-neutral-600">
                We couldn&apos;t load your profile person for your card.
              </p>
              <button
                type="button"
                className="text-sm font-semibold text-[#007AFF] transition hover:underline"
                onClick={() => finishCardForge()}
              >
                Continue without card
              </button>
            </div>
          ) : (
            <OnboardingLoadingPanel variant="saving" compact />
          )}

          {error ? (
            <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          ) : null}
        </div>

        {step !== "doorway" && step !== "card" ? (
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-neutral-200 px-6 py-4 sm:px-8">
            <div className="min-w-0 space-y-1">
              <button
                type="button"
                onClick={goBack}
                disabled={busy}
                className="text-sm font-medium text-neutral-600 hover:text-neutral-900 disabled:opacity-50"
              >
                ← Back
              </button>
              {footerHint ? (
                <p className="max-w-md text-xs text-neutral-400">
                  {footerHint}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {step === "intake" && intakePhase === "select" ? (
                <button
                  type="button"
                  onClick={() => {
                    setStep("you");
                    setYouSubstep(0);
                  }}
                  className="text-sm font-medium text-neutral-500 transition hover:text-neutral-800 hover:underline"
                >
                  Skip — I&apos;ll fill it in myself
                </button>
              ) : null}
              {step === "intake" && intakePhase === "paste" ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setStep("you");
                      setYouSubstep(0);
                    }}
                    disabled={busy}
                    className="text-sm font-medium text-neutral-500 transition hover:text-neutral-800 hover:underline disabled:opacity-50"
                  >
                    Skip for now
                  </button>
                  <button
                    type="button"
                    onClick={() => void submitIntake()}
                    disabled={busy}
                    className="text-sm font-semibold text-[#007AFF] transition hover:underline disabled:opacity-50"
                  >
                    {busy ? "Reading…" : "Continue"}
                  </button>
                </>
              ) : null}
              {showPrimaryNext ? (
                <button
                  type="button"
                  onClick={() => void advance()}
                  disabled={busy}
                  className="text-sm font-semibold text-[#007AFF] transition hover:underline disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Next →"}
                </button>
              ) : null}
            </div>
          </div>
        ) : step === "card" ? (
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-neutral-200 px-6 py-4 sm:px-8">
            <button
              type="button"
              onClick={goBack}
              disabled={busy || avatarBusy}
              className="text-sm font-medium text-neutral-600 hover:text-neutral-900 disabled:opacity-50"
            >
              ← Back
            </button>
            {footerHint ? (
              <p className="max-w-md text-xs text-neutral-400">{footerHint}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
