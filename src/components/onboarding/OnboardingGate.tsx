"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AiProfileTransferStep,
  type AiTransferPhase,
} from "@/components/onboarding/AiProfileTransferStep";
import { OnboardingDoorwayStep } from "@/components/onboarding/OnboardingDoorwayStep";
import { OnboardingLoadingPanel } from "@/components/onboarding/OnboardingLoadingPanel";
import { ShoppingCartRevealStep } from "@/components/onboarding/ShoppingCartRevealStep";
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
import { AvatarStepper } from "@/components/tryon/AvatarStepper";
import { useSelfAvatarStore } from "@/components/tryon/self-avatar-store";
import {
  isPrimaryAiAssistantId,
  type PrimaryAiAssistantId,
} from "@/lib/onboarding/ai-transfer-prompts";
import {
  currencyHintForCountry,
  normalizeGender,
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
  tasteTags: Array<{ tag: string; polarity: string }>;
};

const RAIL_STEPS = [
  { id: "you", label: "Who you are" },
  { id: "taste", label: "What's your taste" },
  { id: "onyou", label: "How it looks on you" },
  { id: "cart", label: "Your shopping cart" },
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

/** Ordered milestones for the whole onboarding flow (including doorway / intake). */
const FLOW_PROGRESS_KEYS = [
  "doorway",
  "intake",
  "you:0",
  "you:1",
  "taste:spend",
  "taste:worn",
  "taste:aspirational",
  "taste:loves",
  "taste:compliments",
  "taste:honesty",
  "onyou",
  "cart",
] as const;

type FlowProgressKey = (typeof FLOW_PROGRESS_KEYS)[number];

function flowProgressKey(
  step: FlowStep,
  youSubstep: 0 | 1,
  tasteSubstep: TasteSubstep,
): FlowProgressKey {
  if (step === "doorway") return "doorway";
  if (step === "intake") return "intake";
  if (step === "you") return youSubstep === 0 ? "you:0" : "you:1";
  if (step === "taste") return `taste:${tasteSubstep}`;
  if (step === "onyou") return "onyou";
  return "cart";
}

/**
 * Ease-out progress: jumps quickly early, slows toward the end.
 * `power` > 1 → more front-loaded.
 */
function exponentialProgressPercent(key: FlowProgressKey, power = 2.35): number {
  const idx = FLOW_PROGRESS_KEYS.indexOf(key);
  if (idx <= 0) return 4;
  const last = FLOW_PROGRESS_KEYS.length - 1;
  if (idx >= last) return 100;
  const t = idx / last;
  return Math.round((1 - Math.pow(1 - t, power)) * 100);
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
  const [selfPersonId, setSelfPersonId] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [editingLocation, setEditingLocation] = useState(false);
  const submissionLockRef = useRef(false);
  const reviewRequestKeyRef = useRef<string | null>(null);
  const wornDeckInFlightRef = useRef(false);
  const aspirationalDeckInFlightRef = useRef(false);

  const [intakeText, setIntakeText] = useState("");
  const [intakePhase, setIntakePhase] = useState<AiTransferPhase>("select");
  const [selectedAi, setSelectedAi] = useState<PrimaryAiAssistantId | "">("");

  const [preferredName, setPreferredName] = useState("");
  const [genderPresentation, setGenderPresentation] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [birthDateSkipped, setBirthDateSkipped] = useState(false);
  const [styleEra, setStyleEra] = useState("");
  const [lifestyleTags, setLifestyleTags] = useState<string[]>([]);

  const [city, setCity] = useState("");
  const [shippingCountry, setShippingCountry] = useState("");
  const [currency, setCurrency] = useState("");
  const [topSize, setTopSize] = useState("");
  const [bottomSize, setBottomSize] = useState("");
  const [shoeEU, setShoeEU] = useState("");
  const [locationConfirmed, setLocationConfirmed] = useState(false);

  const [budgetPhilosophy, setBudgetPhilosophy] = useState("");
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
    if (prefill.budgetPhilosophy) setBudgetPhilosophy(prefill.budgetPhilosophy);
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
      setStyleEra(next.profile?.styleEra ?? "");
      setLifestyleTags(next.profile?.lifestyleTags ?? []);
      setCity(next.profile?.city ?? "");
      setShippingCountry(
        next.profile?.shippingCountry ?? next.profile?.country ?? "",
      );
      setCurrency(next.profile?.currency ?? "");
      setLocationConfirmed(
        Boolean(next.profile?.shippingCountry || next.profile?.country),
      );
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
        setBudgetPhilosophy(next.profile.valuePhilosophy);
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
        if (next.onboarding.started && !next.onboarding.completed) {
          setStep("you");
          setYouSubstep(0);
        }
      } catch {
        if (!ctrl.signal.aborted) setError("Could not load onboarding.");
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    })();
    return () => ctrl.abort();
  }, [hydrateFromStatus]);

  const identityValues = useMemo<YouIdentityValues>(
    () => ({
      preferredName,
      genderPresentation,
      birthDate,
      birthDateSkipped,
      styleEra,
      lifestyleTags,
    }),
    [
      preferredName,
      genderPresentation,
      birthDate,
      birthDateSkipped,
      styleEra,
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
        case "styleEra":
          setStyleEra(value as string);
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
        if (styleEra.trim()) params.set("styleEra", styleEra.trim());
        if (lifestyleTags.length) {
          params.set("lifestyleTags", lifestyleTags.join(","));
        }
        if (budgetPhilosophy.trim()) {
          params.set("valuePhilosophy", budgetPhilosophy.trim());
        }
        if (brandLikes.length) params.set("brandLikes", brandLikes.join(","));
        if (brandAvoids.length)
          params.set("brandAvoids", brandAvoids.join(","));
        if (shippingCountry.trim()) {
          params.set("shippingCountry", shippingCountry.trim());
        }
        if (currency.trim()) params.set("currency", currency.trim());
        if (mode === "aspirational" && wornPicks.length) {
          params.set("wornLabels", wornPicks.map((p) => p.label).join(","));
        }
        const res = await fetch(`/api/onboarding/taste?${params}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error("deck");
        const json = (await res.json()) as { deck: OutfitGridCard[] };
        setDeck(json.deck ?? []);
      } catch {
        setDeck([]);
      } finally {
        inFlight.current = false;
        setLoading(false);
      }
    },
    [
      genderPresentation,
      styleEra,
      lifestyleTags,
      budgetPhilosophy,
      brandLikes,
      brandAvoids,
      shippingCountry,
      currency,
      wornPicks,
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
    const ageRange = styleEraToAgeRange(styleEra);
    if (!styleEra.trim() || !ageRange) missing.push("style era");
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
              styleEra: styleEra.trim(),
              lifestyleTags,
              city: city.trim() || null,
              shippingCountry: shippingCountry.trim() || null,
              country: shippingCountry.trim() || null,
              currency: currency.trim() || null,
              birthDate:
                !birthDateSkipped && birthDate
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
          })),
          aspirationalPicks: aspirationalPicks.map((p) => ({
            id: p.id,
            label: p.label,
            tasteTags: p.tasteTags,
            productTitle: p.title,
            productId: p.productId,
          })),
          brandLikes,
          brandAvoids,
          hardAvoids,
          compliments,
          honestyPreference: honestyPreference || null,
          valuePhilosophy: budgetPhilosophy || null,
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

      if (next.profile && selfPersonId == null) {
        // Ensure we have a self person for avatar; review already created one.
      }
      setStep("onyou");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your taste.");
    } finally {
      submissionLockRef.current = false;
      setBusy(false);
    }
  }

  const goToCart = useCallback(() => {
    setError(null);
    useSelfAvatarStore.getState().markReady();
    void useSelfAvatarStore.getState().refresh();
    setStep("cart");
    setAvatarBusy(false);
  }, []);

  async function completeOnboarding() {
    if (submissionLockRef.current) return;
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
            })),
            aspirationalPicks: aspirationalPicks.map((p) => ({
              id: p.id,
              label: p.label,
              tasteTags: p.tasteTags,
            })),
            brandLikes,
            brandAvoids,
            hardAvoids,
            compliments,
            honestyPreference: honestyPreference || null,
            valuePhilosophy: budgetPhilosophy || null,
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not finish onboarding.");
    } finally {
      submissionLockRef.current = false;
      setBusy(false);
    }
  }

  function goBack() {
    setError(null);
    if (avatarBusy) return;
    if (step === "cart") {
      setStep("onyou");
      return;
    }
    if (step === "onyou") {
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
  useEffect(() => {
    setWornDeck([]);
    setAspirationalDeck([]);
    wornDeckInFlightRef.current = false;
    aspirationalDeckInFlightRef.current = false;
  }, [
    budgetPhilosophy,
    genderPresentation,
    styleEra,
    lifestyleTags,
    shippingCountry,
    currency,
    brandLikes,
    brandAvoids,
  ]);

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

  if (!status?.onboarding || status.onboarding.completed) return null;

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
    if (step === "onyou") {
      return {
        eyebrow: "GETTING STARTED",
        title: "One more thing... want your finds on YOU?",
        subtitle:
          "Add a photo and every outfit I show can appear on your body, your proportions... before you spend a cent.",
      };
    }
    return {
      eyebrow: "GETTING STARTED",
      title: `Meet your Shooping Cart${preferredName.trim() ? `, ${preferredName.trim()}` : ""}.`,
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
    if (step === "onyou") {
      return "Everything works without photos. Skip anytime and add later in Settings.";
    }
    return "";
  })();

  const showRail = railStep != null;
  const progressPercent = exponentialProgressPercent(
    flowProgressKey(step, youSubstep, tasteSubstep),
  );
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
              value={budgetPhilosophy}
              onChange={setBudgetPhilosophy}
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
                styleEra,
                lifestyleTags,
                valuePhilosophy: budgetPhilosophy,
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
          ) : step === "onyou" && selfPersonId ? (
            <AvatarStepper
              key={selfPersonId}
              personId={selfPersonId}
              personLabel="You"
              startAtPhoto
              photoTitle="Start with a clear photo"
              photoSubtitle="Clothes adapt to you, never the other way. Your photos train nothing and are sold to no one. Skip anytime."
              onBusyChange={setAvatarBusy}
              onSkip={() => goToCart()}
              onComplete={() => goToCart()}
            />
          ) : step === "onyou" ? (
            <div className="space-y-4 py-8 text-center">
              <p className="text-sm text-neutral-600">
                We couldn&apos;t load your profile person for avatar setup.
              </p>
              <button
                type="button"
                className="rounded-full bg-brand px-5 py-2 text-sm font-bold text-white"
                onClick={() => goToCart()}
              >
                Continue without avatar
              </button>
            </div>
          ) : step === "cart" ? (
            <ShoppingCartRevealStep
              preferredName={preferredName}
              styleMix={styleMix}
              busy={busy}
              onContinue={() => void completeOnboarding()}
              onSaveCard={() => void completeOnboarding()}
            />
          ) : (
            <OnboardingLoadingPanel variant="saving" compact />
          )}

          {error ? (
            <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          ) : null}
        </div>

        {step !== "doorway" && step !== "cart" ? (
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-neutral-200 px-6 py-4 sm:px-8">
            <div className="min-w-0 space-y-1">
              {step !== "onyou" || !avatarBusy ? (
                <button
                  type="button"
                  onClick={goBack}
                  disabled={busy || avatarBusy}
                  className="text-sm font-medium text-neutral-600 hover:text-neutral-900 disabled:opacity-50"
                >
                  ← Back
                </button>
              ) : null}
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
                  className="rounded-full border border-neutral-200 px-4 py-2.5 text-sm font-semibold"
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
                    className="rounded-full border border-neutral-200 px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
                  >
                    Skip for now
                  </button>
                  <button
                    type="button"
                    onClick={() => void submitIntake()}
                    disabled={busy}
                    className="rounded-full bg-[#3B6F9E] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#335f88] disabled:opacity-50"
                  >
                    {busy ? "Reading…" : "Continue"}
                  </button>
                </>
              ) : null}
              {step === "onyou" ? (
                <button
                  type="button"
                  onClick={() => goToCart()}
                  disabled={busy || avatarBusy}
                  className="rounded-full border border-neutral-200 px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
                >
                  Maybe later
                </button>
              ) : null}
              {showPrimaryNext ? (
                <button
                  type="button"
                  onClick={() => void advance()}
                  disabled={busy}
                  className="rounded-full bg-[#3B6F9E] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#335f88] disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Next →"}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
