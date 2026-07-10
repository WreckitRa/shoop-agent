"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  TasteSwipeStep,
  type TasteDeckCard,
  type TasteSwipeResult,
} from "@/components/onboarding/TasteSwipeStep";
import { AiProfileTransferStep, type AiTransferPhase } from "@/components/onboarding/AiProfileTransferStep";
import { OnboardingLoadingPanel } from "@/components/onboarding/OnboardingLoadingPanel";
import {
  OnboardingProfileStep,
  type OnboardingProfileValues,
} from "@/components/onboarding/OnboardingProfileStep";
import {
  isPrimaryAiAssistantId,
  type PrimaryAiAssistantId,
} from "@/lib/onboarding/ai-transfer-prompts";
import { normalizeAgeRange, normalizeGender } from "@/lib/onboarding/form-options";
import { tagsFromFreeText, tasteTagsForPatch } from "@/lib/onboarding/taste-tags";
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
  styleLikes?: string;
  styleAvoids?: string;
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
    genderPresentation: string | null;
    country: string | null;
    city: string | null;
    currency: string | null;
    shippingCountry: string | null;
    valuePhilosophy: string | null;
    primaryAiAssistant: string | null;
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

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function joinCsv(values: string[]): string {
  return values.join(", ");
}

const ONBOARDING_STEPS = [
  { id: "intake", label: "Transfer" },
  { id: "review", label: "Profile" },
  { id: "taste", label: "Taste" },
] as const;

async function fetchStatus(
  signal?: AbortSignal,
): Promise<OnboardingStatus | "unauthorized"> {
  const res = await fetch("/api/onboarding", { cache: "no-store", signal });
  if (res.status === 401) return "unauthorized";
  if (!res.ok) throw new Error("load");
  return (await res.json()) as OnboardingStatus;
}

export function OnboardingGate() {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"intake" | "review" | "taste">("intake");
  const [tasteDeck, setTasteDeck] = useState<TasteDeckCard[]>([]);
  const [tasteDeckLoading, setTasteDeckLoading] = useState(false);
  const [tasteSaving, setTasteSaving] = useState(false);

  const [intakeText, setIntakeText] = useState("");
  const [intakePhase, setIntakePhase] = useState<AiTransferPhase>("select");
  const [selectedAi, setSelectedAi] = useState<PrimaryAiAssistantId | "">("");
  const [preferredName, setPreferredName] = useState("");
  const [genderPresentation, setGenderPresentation] = useState("");
  const [ageRange, setAgeRange] = useState("");

  const [shippingCountry, setShippingCountry] = useState("");
  const [currency, setCurrency] = useState("");
  const [topSize, setTopSize] = useState("");
  const [bottomSize, setBottomSize] = useState("");
  const [shoeEU, setShoeEU] = useState("");
  const [styleLikes, setStyleLikes] = useState("");
  const [styleAvoids, setStyleAvoids] = useState("");
  const [brandLikes, setBrandLikes] = useState("");
  const [brandAvoids, setBrandAvoids] = useState("");
  const [hardAvoids, setHardAvoids] = useState("");
  const [budgetPhilosophy, setBudgetPhilosophy] = useState("");
  const [extraNotes, setExtraNotes] = useState("");

  const applyPrefill = useCallback((prefill: OnboardingPrefill) => {
    if (prefill.preferredName) setPreferredName(prefill.preferredName);
    if (prefill.genderPresentation) {
      setGenderPresentation(normalizeGender(prefill.genderPresentation));
    }
    if (prefill.ageRange) setAgeRange(normalizeAgeRange(prefill.ageRange));
    if (prefill.shippingCountry) setShippingCountry(prefill.shippingCountry);
    if (prefill.currency) setCurrency(prefill.currency);
    if (prefill.topSize) setTopSize(prefill.topSize);
    if (prefill.bottomSize) setBottomSize(prefill.bottomSize);
    if (prefill.shoeEU) setShoeEU(prefill.shoeEU);
    if (prefill.budgetPhilosophy) setBudgetPhilosophy(prefill.budgetPhilosophy);
    if (prefill.styleLikes) setStyleLikes(prefill.styleLikes);
    if (prefill.styleAvoids) setStyleAvoids(prefill.styleAvoids);
    if (prefill.brandLikes) setBrandLikes(prefill.brandLikes);
    if (prefill.brandAvoids) setBrandAvoids(prefill.brandAvoids);
    if (prefill.hardAvoids) setHardAvoids(prefill.hardAvoids);
  }, []);

  const hydrateFromStatus = useCallback((next: OnboardingStatus, prefill?: OnboardingPrefill) => {
    setStatus(next);
    setPreferredName(next.profile?.preferredName ?? "");
    setGenderPresentation(normalizeGender(next.profile?.genderPresentation));
    setAgeRange(normalizeAgeRange(next.profile?.ageRange));
    setShippingCountry(next.profile?.shippingCountry ?? next.profile?.country ?? "");
    setCurrency(next.profile?.currency ?? "");
    setTopSize(next.sizing?.topUsualSize ?? "");
    setBottomSize(next.sizing?.bottomUsualSize ?? "");
    setShoeEU(
      next.sizing?.shoeEU != null
        ? String(next.sizing.shoeEU)
        : next.sizing?.shoeUS != null
          ? String(next.sizing.shoeUS)
          : "",
    );
    setBudgetPhilosophy(next.profile?.valuePhilosophy ?? "");
    setStyleLikes(
      joinCsv(
        next.tasteTags.filter((t) => t.polarity === "positive").map((t) => t.tag),
      ),
    );
    setStyleAvoids(
      joinCsv(
        next.tasteTags.filter((t) => t.polarity === "negative").map((t) => t.tag),
      ),
    );
    setBrandLikes(
      joinCsv(
        next.brandPreferences
          .filter((b) => b.sentiment === "love" || b.sentiment === "like")
          .map((b) => b.brand),
      ),
    );
    setBrandAvoids(
      joinCsv(
        next.brandPreferences
          .filter((b) => b.sentiment === "avoid" || b.sentiment === "hate")
          .map((b) => b.brand),
      ),
    );
    setHardAvoids(joinCsv(next.hardNegatives.map((h) => h.value)));
    const ai = next.profile?.primaryAiAssistant ?? "";
    if (ai && isPrimaryAiAssistantId(ai)) {
      setSelectedAi(ai);
      setIntakePhase("paste");
    } else {
      setSelectedAi("");
      setIntakePhase("select");
    }
    if (prefill) applyPrefill(prefill);
  }, [applyPrefill]);

  const savePrimaryAi = useCallback((id: PrimaryAiAssistantId) => {
    setSelectedAi(id);
    setIntakePhase("paste");
    void fetch("/api/onboarding", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: { primaryAiAssistant: id } }),
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    void (async () => {
      try {
        const next = await fetchStatus(ctrl.signal);
        if (!ctrl.signal.aborted && next === "unauthorized") {
          return;
        }
        if (!ctrl.signal.aborted && next !== "unauthorized") {
          hydrateFromStatus(next);
          if (next.onboarding.started) {
            setStep("review");
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

  const hasPrefill = useMemo(() => {
    return Boolean(
      preferredName.trim() ||
        genderPresentation.trim() ||
        ageRange.trim() ||
        shippingCountry.trim() ||
        currency.trim() ||
        topSize.trim() ||
        bottomSize.trim() ||
        shoeEU.trim() ||
        styleLikes.trim() ||
        styleAvoids.trim() ||
        brandLikes.trim() ||
        brandAvoids.trim() ||
        hardAvoids.trim() ||
        budgetPhilosophy.trim(),
    );
  }, [
    preferredName,
    genderPresentation,
    ageRange,
    shippingCountry,
    currency,
    topSize,
    bottomSize,
    shoeEU,
    styleLikes,
    styleAvoids,
    brandLikes,
    brandAvoids,
    hardAvoids,
    budgetPhilosophy,
  ]);

  const profileValues = useMemo<OnboardingProfileValues>(
    () => ({
      preferredName,
      genderPresentation,
      ageRange,
      shippingCountry,
      currency,
      topSize,
      bottomSize,
      shoeEU,
      budgetPhilosophy,
      styleLikes,
      styleAvoids,
      brandLikes,
      brandAvoids,
      hardAvoids,
      extraNotes,
    }),
    [
      preferredName,
      genderPresentation,
      ageRange,
      shippingCountry,
      currency,
      topSize,
      bottomSize,
      shoeEU,
      budgetPhilosophy,
      styleLikes,
      styleAvoids,
      brandLikes,
      brandAvoids,
      hardAvoids,
      extraNotes,
    ],
  );

  const profileOnChange = useCallback(
    <K extends keyof OnboardingProfileValues>(key: K, value: OnboardingProfileValues[K]) => {
      switch (key) {
        case "preferredName":
          setPreferredName(value);
          break;
        case "genderPresentation":
          setGenderPresentation(value);
          break;
        case "ageRange":
          setAgeRange(value);
          break;
        case "shippingCountry":
          setShippingCountry(value);
          break;
        case "currency":
          setCurrency(value);
          break;
        case "topSize":
          setTopSize(value);
          break;
        case "bottomSize":
          setBottomSize(value);
          break;
        case "shoeEU":
          setShoeEU(value);
          break;
        case "budgetPhilosophy":
          setBudgetPhilosophy(value);
          break;
        case "styleLikes":
          setStyleLikes(value);
          break;
        case "styleAvoids":
          setStyleAvoids(value);
          break;
        case "brandLikes":
          setBrandLikes(value);
          break;
        case "brandAvoids":
          setBrandAvoids(value);
          break;
        case "hardAvoids":
          setHardAvoids(value);
          break;
        case "extraNotes":
          setExtraNotes(value);
          break;
      }
    },
    [],
  );

  function goBack() {
    setError(null);
    if (step === "taste") setStep("review");
    else if (step === "review") setStep("intake");
    else if (step === "intake" && intakePhase === "paste") setIntakePhase("select");
  }

  const loadTasteDeck = useCallback(async () => {
    setTasteDeckLoading(true);
    try {
      const params = new URLSearchParams();
      if (styleLikes.trim()) params.set("styleLikes", styleLikes.trim());
      if (styleAvoids.trim()) params.set("styleAvoids", styleAvoids.trim());
      if (brandLikes.trim()) params.set("brandLikes", brandLikes.trim());
      if (brandAvoids.trim()) params.set("brandAvoids", brandAvoids.trim());
      if (genderPresentation.trim()) {
        params.set("genderPresentation", genderPresentation.trim());
      }
      if (budgetPhilosophy.trim()) params.set("valuePhilosophy", budgetPhilosophy.trim());
      if (shippingCountry.trim()) params.set("shippingCountry", shippingCountry.trim());
      if (currency.trim()) params.set("currency", currency.trim());
      if (topSize.trim()) params.set("topSize", topSize.trim());
      const res = await fetch(`/api/onboarding/taste?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("deck");
      const json = (await res.json()) as { deck: TasteDeckCard[] };
      setTasteDeck(json.deck ?? []);
    } catch {
      setTasteDeck([]);
    } finally {
      setTasteDeckLoading(false);
    }
  }, [
    styleLikes,
    styleAvoids,
    brandLikes,
    brandAvoids,
    genderPresentation,
    budgetPhilosophy,
    shippingCountry,
    currency,
    topSize,
  ]);

  async function finishOnboarding() {
    const done = await fetch("/api/onboarding", { method: "POST" });
    const next = (await done.json()) as OnboardingStatus & { error?: string };
    if (!done.ok) {
      hydrateFromStatus(next);
      throw new Error(next.error ?? "Required basics are missing.");
    }
    hydrateFromStatus(next);
    useUserProfileStore.getState().setOnboardingCompleted(true);
    void useUserProfileStore.getState().hydrate({ force: true });
  }

  async function saveTasteSwipes(responses: TasteSwipeResult[]) {
    setTasteSaving(true);
    setBusy(true);
    setError(null);
    try {
      if (responses.some((r) => r.swipe !== "neutral")) {
        const res = await fetch("/api/onboarding/taste", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ responses }),
        });
        if (!res.ok) throw new Error("taste");
      }
      await finishOnboarding();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your picks. Please try again.");
      setTasteSaving(false);
    } finally {
      setBusy(false);
    }
  }

  async function submitIntake() {
    if (!intakeText.trim()) {
      setStep("review");
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
      setStep("review");
    } catch {
      setError("We couldn't read that just yet — no worries, you can fill in the form yourself.");
      setStep("review");
    } finally {
      setBusy(false);
    }
  }

  async function submitReview() {
    const missing: string[] = [];
    if (!preferredName.trim()) missing.push("name");
    if (!genderPresentation.trim()) missing.push("clothing style");
    if (!ageRange.trim()) missing.push("age group");
    if (missing.length) {
      setError(`Almost there — just add your ${missing.join(" and ")}.`);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const brands = [
        ...splitCsv(brandLikes).map((brand) => ({ brand, sentiment: "love" as const })),
        ...splitCsv(brandAvoids).map((brand) => ({ brand, sentiment: "avoid" as const })),
      ];
      const tasteTags = tasteTagsForPatch(styleLikes, styleAvoids);
      const hardNegatives = tagsFromFreeText(hardAvoids, 24).map((value) => ({
        scope: "style" as const,
        value: value.slice(0, 120),
        reason: "taste" as const,
      }));
      const sizing: Record<string, unknown> = {};
      if (topSize.trim()) sizing.topUsualSize = topSize.trim();
      if (bottomSize.trim()) sizing.bottomUsualSize = bottomSize.trim();
      if (shoeEU.trim()) sizing.shoeEU = Number(shoeEU);

      const patch = await fetch("/api/onboarding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: {
            preferredName: preferredName.trim(),
            genderPresentation: genderPresentation.trim(),
            ageRange: ageRange.trim(),
            shippingCountry: shippingCountry.trim() || null,
            currency: currency.trim() || null,
            valuePhilosophy: budgetPhilosophy.trim() || null,
          },
          ...(Object.keys(sizing).length ? { sizing } : {}),
          ...(brands.length ? { brands } : {}),
          ...(tasteTags.length ? { tasteTags } : {}),
          ...(hardNegatives.length ? { hardNegatives } : {}),
        }),
      });
      const patchJson = (await patch.json()) as OnboardingStatus & { error?: string };
      if (!patch.ok) {
        throw new Error(patchJson.error ?? "Could not save your profile.");
      }
      hydrateFromStatus(patchJson);

      if (extraNotes.trim()) {
        await fetch("/api/onboarding/intake", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: extraNotes }),
        }).catch(() => {});
      }

      await loadTasteDeck();
      setStep("taste");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your profile.");
    } finally {
      setBusy(false);
    }
  }

  if (!status?.onboarding || status.onboarding.completed) return null;

  const stepSubtitle =
    step === "taste"
      ? tasteSaving
        ? "Hang tight — we're personalizing Shoop for you."
        : "Tap a button or drag the card to tell us what you like."
      : step === "intake"
        ? intakePhase === "select"
          ? "Which AI do you use? We'll give you a short message to copy — so you can bring your preferences over in one go."
          : "Copy the message below into your AI, then paste what it writes back here."
        : step === "review"
          ? "Three quick questions to get started. Everything else is optional."
          : "";

  const stepTitle =
    tasteSaving && step === "taste"
      ? "You're all set"
      : step === "taste"
        ? "What's your style?"
        : "Let Shoop get to know you";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] border border-hairline bg-white shadow-lift"
      >
        <div className="shrink-0 border-b border-neutral-200 px-6 py-5">
          <div className="mb-4 flex items-center justify-center gap-2">
            {ONBOARDING_STEPS.map((s, i) => {
              const active = step === s.id;
              const done =
                (s.id === "intake" && (step === "review" || step === "taste")) ||
                (s.id === "review" && step === "taste");
              return (
                <div key={s.id} className="flex items-center gap-2">
                  {i > 0 ? <div className="h-px w-6 bg-hairline sm:w-10" aria-hidden /> : null}
                  <div className="flex items-center gap-1.5">
                    <div
                      className={
                        active
                          ? "size-2 rounded-full bg-brand"
                          : done
                            ? "size-2 rounded-full bg-brand/40"
                            : "size-2 rounded-full bg-hairline"
                      }
                    />
                    <span
                      className={
                        active
                          ? "text-xs font-semibold text-brand-dark"
                          : done
                            ? "text-xs font-medium text-ink-muted"
                            : "text-xs text-ink-muted"
                      }
                    >
                      {s.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Getting started
          </p>
          <h2 id="onboarding-title" className="mt-1 text-2xl font-semibold tracking-tight">
            {stepTitle}
          </h2>
          {stepSubtitle ? (
            <p className="mt-2 text-sm leading-6 text-neutral-600">{stepSubtitle}</p>
          ) : null}
        </div>

        <div
          className={
            step === "taste"
              ? "flex min-h-0 flex-1 flex-col overflow-hidden px-6 py-4"
              : "flex-1 overflow-y-auto px-6 py-5"
          }
        >
          {loading ? (
            <div className="py-16 text-center text-sm text-neutral-500">One moment…</div>
          ) : step === "taste" && tasteSaving ? (
            <OnboardingLoadingPanel variant="saving" compact />
          ) : step === "taste" ? (
            <TasteSwipeStep
              key={tasteDeck.map((c) => c.id).join(",") || "empty"}
              deck={tasteDeck}
              loading={tasteDeckLoading}
              busy={busy}
              compact
              onComplete={(responses) => void saveTasteSwipes(responses)}
              onSkip={() => void saveTasteSwipes([])}
            />
          ) : step === "intake" ? (
            <AiProfileTransferStep
              phase={intakePhase}
              selectedAi={selectedAi}
              intakeText={intakeText}
              onSelectAi={savePrimaryAi}
              onIntakeChange={setIntakeText}
              onBackToSelect={() => setIntakePhase("select")}
            />
          ) : (
            <OnboardingProfileStep
              values={profileValues}
              hasPrefill={hasPrefill}
              onChange={profileOnChange}
            />
          )}

          {error ? (
            <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          ) : null}
        </div>

        <div className="shrink-0 border-t border-neutral-200 px-6 py-4">
          {step === "taste" && !tasteSaving ? (
            <div className="flex w-full items-center justify-between gap-4">
              <button
                type="button"
                onClick={goBack}
                disabled={busy}
                className="text-sm font-medium text-neutral-600 hover:text-neutral-900 disabled:opacity-50"
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={() => void saveTasteSwipes([])}
                disabled={busy}
                className="text-sm font-medium text-neutral-500 hover:text-neutral-800 disabled:opacity-50"
              >
                Skip for now
              </button>
            </div>
          ) : step !== "taste" ? (
            <div className="flex w-full flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 space-y-1">
            {step === "review" || (step === "intake" && intakePhase === "paste") ? (
              <button
                type="button"
                onClick={goBack}
                disabled={busy}
                className="text-sm font-medium text-neutral-600 hover:text-neutral-900 disabled:opacity-50"
              >
                {step === "review"
                  ? "← Back"
                  : "← Choose a different AI"}
              </button>
            ) : null}
            <p className="text-xs text-neutral-500">
              {step === "intake"
                ? intakePhase === "select"
                  ? "Tap an AI to continue, or skip and fill things in yourself."
                  : "Paste your AI's reply above, or skip and fill things in yourself."
                : step === "review"
                  ? "Only three fields are required — the rest is up to you."
                  : "You can go back and change anything anytime."}
            </p>
              </div>
              <div className="flex flex-wrap gap-2">
            {step === "intake" && intakePhase === "paste" ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    void fetch("/api/onboarding", {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({}),
                    }).catch(() => {});
                    setStep("review");
                  }}
                  disabled={busy}
                  className="rounded-full border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50"
                >
                  Skip for now
                </button>
                <button
                  type="button"
                  onClick={() => void submitIntake()}
                  disabled={busy}
                  className="btn-primary rounded-full px-5 py-2 disabled:opacity-50"
                >
                  {busy ? "Reading your profile…" : "Continue"}
                </button>
              </>
            ) : step === "intake" && intakePhase === "select" ? (
              <button
                type="button"
                onClick={() => {
                  void fetch("/api/onboarding", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({}),
                  }).catch(() => {});
                  setStep("review");
                }}
                disabled={busy}
                className="rounded-full border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50"
              >
                Skip — I&apos;ll fill it in myself
              </button>
            ) : step === "review" ? (
              <button
                type="button"
                onClick={() => void submitReview()}
                disabled={busy}
                className="btn-primary rounded-full px-5 py-2 disabled:opacity-50"
              >
                {busy ? "Saving…" : "Continue →"}
              </button>
            ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
