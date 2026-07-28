"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Camera, Sun, UserRound } from "lucide-react";
import {
  OnboardingQGroup,
  OnboardingTile,
  OnboardingWhy,
} from "@/components/onboarding/onboarding-ui";
import {
  ShoopCard,
  stubSerialFromId,
  type ShoopCardState,
} from "@/components/onboarding/ShoopCard";
import { guestFetch } from "@/lib/client/guest-fetch";
import {
  styleEraLabel,
} from "@/lib/onboarding/form-options";
import type { StyleMix } from "@/lib/onboarding/style-mix";
import { useSelfAvatarStore } from "@/components/tryon/self-avatar-store";
import {
  TRYON_CLIENT_POLL_MAX_MS,
  TRYON_CLIENT_POLL_MS,
} from "@/lib/tryon/client-poll";
import { isCompareSettled } from "@/lib/tryon/compare-variants";
import type {
  AvatarAttributes,
  AvatarCompareVariant,
  BuildBand,
  MuscularityBand,
} from "@/lib/tryon/types";

export type CardForgeSubstep =
  | "photo"
  | "height"
  | "build"
  | "definition"
  | "mint"
  | "reveal";

export const CARD_FORGE_SUBSTEPS: CardForgeSubstep[] = [
  "photo",
  "height",
  "build",
  "definition",
  "mint",
  "reveal",
];

export const CARD_FORGE_STEP_META: Record<
  Exclude<CardForgeSubstep, "reveal">,
  { n: number; label: string; clarity: string }
> = {
  photo: { n: 1, label: "THE PHOTO", clarity: "10% → 30%" },
  height: { n: 2, label: "HEIGHT", clarity: "30% → 50%" },
  build: { n: 3, label: "BUILD", clarity: "50% → 70%" },
  definition: { n: 4, label: "DEFINITION", clarity: "70% → 85%" },
  mint: { n: 5, label: "THE MINT", clarity: "85% → 100%" },
};

export function cardForgeCopy(
  substep: CardForgeSubstep,
  preferredName = "",
): { title: string; subtitle: string | null } {
  const first =
    preferredName.trim().split(/\s+/)[0] || "";
  switch (substep) {
    case "photo":
      return {
        title: "Give me your best angle.",
        subtitle:
          "See the figure in the fog? That's you, undeveloped. One photo and the face arrives... the first 30% of clarity.",
      };
    case "height":
      return {
        title: "How tall are you?",
        subtitle:
          "Watch the card... the figure grows with you, and the fog thins. Proportion is half of fit.",
      };
    case "build":
      return {
        title: "What's your build?",
        subtitle:
          "Honesty beats flattery... true fit is the whole point. The shoulders are listening.",
      };
    case "definition":
      return {
        title: "Definition under clothes?",
        subtitle:
          "Soft is completely fine... this only shapes how fabric sits. One answer from 85%.",
      };
    case "mint":
      return {
        title: "Time to mint you.",
        subtitle:
          "The last 15% happens in the atelier. Then full clarity, and the foil.",
      };
    case "reveal":
      return {
        title: first
          ? `Say hello to you, ${first}.`
          : "Say hello to you.",
        subtitle:
          "Out of the fog, dressed from your split... one of the early cards that will ever exist. Then let's put it to work.",
      };
  }
}

/** Apple system blue. Mint is the only filled CTA; everything else is a text link. */
const linkBtn =
  "text-sm font-semibold text-[#007AFF] transition hover:underline disabled:opacity-50";
const linkMutedBtn =
  "text-sm font-medium text-neutral-500 transition hover:text-neutral-800 hover:underline disabled:opacity-50";
const mintBtn =
  "rounded-full bg-[#007AFF] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#0066D6] disabled:opacity-50";

type Props = {
  personId: string;
  preferredName?: string;
  styleEra?: string | null;
  styleMix?: StyleMix | null;
  onBusyChange?: (busy: boolean) => void;
  /** Persist progress (async). Gate/modal stay open until welcome finishes. */
  onComplete: () => void | Promise<void>;
  /** Called after the welcome beat — parent may close the flow. */
  onWelcomeDone?: () => void;
  /** Skip the whole forge (e.g. onboarding continue without avatar). */
  onSkipAll?: () => void;
  /** Controlled substep (onboarding progress sync). */
  substep?: CardForgeSubstep;
  onSubstepChange?: (substep: CardForgeSubstep) => void;
  /** When false (onboarding), parent owns the progress bar — no in-step tag. */
  showStepTag?: boolean;
};

const DEFAULT_MIX: StyleMix = {
  axes: [
    { label: "Parisian", percent: 42 },
    { label: "Bold", percent: 42 },
    { label: "Minimal", percent: 16 },
  ],
  headingToward: "Effortless",
  headingPercent: 25,
};

const BUILD_OPTIONS: {
  id: BuildBand;
  label: string;
  hint: string;
}[] = [
  { id: "slim", label: "Slim", hint: "Narrow through the torso" },
  { id: "average", label: "Average", hint: "Balanced everyday build" },
  { id: "athletic", label: "Athletic", hint: "Stronger shoulders" },
  { id: "broad", label: "Broad", hint: "Wider chest and frame" },
  { id: "plus", label: "Plus", hint: "Fuller, curvier silhouette" },
];

const MUSCLE_OPTIONS: {
  id: MuscularityBand;
  label: string;
  hint: string;
}[] = [
  { id: "low", label: "Soft", hint: "Relaxed, natural" },
  { id: "moderate", label: "Toned", hint: "Light definition" },
  { id: "high", label: "Defined", hint: "Visible shape" },
];

const PHOTO_TIPS = [
  { icon: Sun, title: "Face the light", body: "Window light is perfect" },
  { icon: UserRound, title: "Just you", body: "Eyes toward the camera" },
  { icon: Camera, title: "No shades", body: "Skip heavy filters too" },
] as const;

const MINT_BEATS = [
  "matching your light",
  "tailoring the frame",
  "dressing you from your split",
  "the foil",
] as const;

function heightBandFromCm(cm: number): AvatarAttributes["height_band"] {
  if (cm < 160) return "under_160";
  if (cm < 170) return "160_170";
  if (cm < 180) return "170_180";
  if (cm < 190) return "180_190";
  return "over_190";
}

function clarityFor(
  photo: boolean,
  height: boolean,
  build: boolean,
  definition: boolean,
  minted: boolean,
): number {
  if (minted) return 100;
  if (definition) return 85;
  if (build) return 70;
  if (height) return 50;
  if (photo) return 30;
  return 10;
}

type AvatarApiBody = {
  error?: string;
  avatar?: { url?: string };
  draft?: {
    step?: string;
    preview_url?: string;
    compare?: boolean;
    compare_job_id?: string;
    preview_variants?: AvatarCompareVariant[];
    intake?: {
      refusal_message?: string;
    };
  };
};

async function readApiJson(res: Response): Promise<AvatarApiBody> {
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

export function CardForgeStep({
  personId,
  preferredName = "",
  styleEra,
  styleMix,
  onBusyChange,
  onComplete,
  onWelcomeDone,
  onSkipAll,
  substep: controlledSubstep,
  onSubstepChange,
  showStepTag = false,
}: Props) {
  const mix = styleMix ?? DEFAULT_MIX;
  const eraLabel = styleEra?.trim()
    ? styleEraLabel(styleEra)
    : "30s · Prime era";

  const [uncontrolledSubstep, setUncontrolledSubstep] =
    useState<CardForgeSubstep>("photo");
  const substep = controlledSubstep ?? uncontrolledSubstep;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [shareFlash, setShareFlash] = useState(false);

  const [photoReady, setPhotoReady] = useState(false);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [heightCm, setHeightCm] = useState<number | null>(null);
  const [heightDraft, setHeightDraft] = useState(175);
  const [build, setBuild] = useState<BuildBand | null>(null);
  const [buildDraft, setBuildDraft] = useState<BuildBand | null>(null);
  const [muscularity, setMuscularity] = useState<MuscularityBand | null>(null);
  const [muscleDraft, setMuscleDraft] = useState<MuscularityBand | null>(null);

  const [minted, setMinted] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [mintBeat, setMintBeat] = useState<0 | 1 | 2 | 3 | 4>(0);
  const [mintBeatLabels, setMintBeatLabels] = useState<boolean[]>([
    false,
    false,
    false,
    false,
  ]);
  const [exitPhase, setExitPhase] = useState<"idle" | "saving" | "welcome">(
    "idle",
  );

  const fileRef = useRef<HTMLInputElement>(null);
  const startedRef = useRef(false);
  const mintAbortRef = useRef(false);
  const hydratedExistingRef = useRef(false);

  const setBusyState = useCallback(
    (next: boolean) => {
      setBusy(next);
      onBusyChange?.(next);
    },
    [onBusyChange],
  );

  const go = useCallback(
    (next: CardForgeSubstep) => {
      if (controlledSubstep === undefined) setUncontrolledSubstep(next);
      onSubstepChange?.(next);
    },
    [controlledSubstep, onSubstepChange],
  );

  /** If this person already has a persisted avatar, skip remint (no extra FASHN credit). */
  useEffect(() => {
    if (hydratedExistingRef.current || !personId) return;
    hydratedExistingRef.current = true;
    const ctrl = new AbortController();
    void (async () => {
      try {
        const res = await guestFetch("/api/avatar/people", {
          cache: "no-store",
          signal: ctrl.signal,
        });
        if (!res.ok || ctrl.signal.aborted) return;
        const json = (await res.json()) as {
          people?: Array<{
            id: string;
            has_avatar?: boolean;
            avatar_url?: string | null;
          }>;
        };
        const self =
          json.people?.find((p) => p.id === personId) ?? json.people?.[0];
        if (!self?.has_avatar || !self.avatar_url) return;
        setAvatarUrl(self.avatar_url);
        setMinted(true);
        setPhotoReady(true);
        setMintBeat(4);
        setMintBeatLabels([true, true, true, true]);
        useSelfAvatarStore.getState().markReady(self.avatar_url);
        go("reveal");
      } catch {
        /* ignore — fresh forge */
      }
    })();
    return () => ctrl.abort();
  }, [personId, go]);

  useEffect(() => {
    if (controlledSubstep === undefined) onSubstepChange?.("photo");
  }, [controlledSubstep, onSubstepChange]);

  useEffect(() => {
    return () => {
      if (localPreview) URL.revokeObjectURL(localPreview);
    };
  }, [localPreview]);

  const clarity = clarityFor(
    photoReady,
    heightCm != null,
    build != null,
    muscularity != null,
    minted,
  );

  const syncScore = mix.axes[0]?.percent ?? 34;
  const serial = stubSerialFromId(personId);

  const cardState: ShoopCardState = useMemo(
    () => ({
      preferredName,
      eraLabel,
      styleMix: mix,
      heightCm,
      build,
      muscularity,
      clarity,
      previewHeightCm:
        substep === "height" && heightCm == null ? heightDraft : null,
      previewBuild:
        substep === "build" && build == null ? buildDraft : null,
      minted,
      avatarUrl,
      faceReady: photoReady,
      serial,
      syncScore,
      mintBeat: substep === "mint" ? mintBeat : minted ? 4 : 0,
    }),
    [
      preferredName,
      eraLabel,
      mix,
      heightCm,
      build,
      muscularity,
      clarity,
      substep,
      heightDraft,
      buildDraft,
      minted,
      avatarUrl,
      photoReady,
      serial,
      syncScore,
      mintBeat,
    ],
  );

  const start = useCallback(async () => {
    if (startedRef.current) return;
    await guestFetch("/api/avatar/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ person_id: personId }),
    });
    startedRef.current = true;
  }, [personId]);

  const onPhoto = async (file: File) => {
    setBusyState(true);
    setMessage(null);
    const objectUrl = URL.createObjectURL(file);
    setLocalPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return objectUrl;
    });
    setPhotoReady(false);

    try {
      await start();
      const form = new FormData();
      form.set("person_id", personId);
      form.set("photo", file);
      const res = await guestFetch("/api/avatar/upload", {
        method: "POST",
        body: form,
      });
      const body = await readApiJson(res);
      if (!res.ok || body.error) {
        setMessage(body.error ?? "Could not upload photo.");
        setBusyState(false);
        return;
      }
      if (body.draft?.step === "refused_minor") {
        setMessage(
          body.draft.intake?.refusal_message ?? "We can't use this photo.",
        );
        setBusyState(false);
        return;
      }

      const checkRes = await guestFetch("/api/avatar/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check", person_id: personId }),
      });
      const checkBody = await readApiJson(checkRes);
      if (checkBody.draft?.step === "refused_minor") {
        setMessage(
          checkBody.draft.intake?.refusal_message ??
            "We can't use this photo.",
        );
        setBusyState(false);
        return;
      }

      setPhotoReady(true);
      setBusyState(false);
      window.setTimeout(() => go("height"), 420);
    } catch {
      setMessage("Upload failed — try another photo.");
      setBusyState(false);
    }
  };

  const applyAvatarPoll = useCallback(
    (body: {
      status?: string;
      variants?: AvatarCompareVariant[];
      draft?: AvatarApiBody["draft"];
    }) => {
      const variants = body.variants ?? body.draft?.preview_variants ?? [];
      const selected =
        variants.find((v) => v.preview_url) ??
        (body.draft?.preview_url
          ? { preview_url: body.draft.preview_url }
          : undefined);
      if (selected?.preview_url) {
        setAvatarUrl(selected.preview_url);
      }
      return isCompareSettled(variants) || Boolean(body.draft?.preview_url);
    },
    [],
  );

  const pollAvatarJob = useCallback(
    async (jobId: string, startedAt: number): Promise<string | null> => {
      if (mintAbortRef.current) return null;
      if (Date.now() - startedAt > TRYON_CLIENT_POLL_MAX_MS) {
        return null;
      }
      const res = await guestFetch(
        `/api/avatar/job/${jobId}?person_id=${encodeURIComponent(personId)}`,
      );
      const body = (await readApiJson(res)) as {
        error?: string;
        status?: string;
        variants?: AvatarCompareVariant[];
        draft?: AvatarApiBody["draft"];
      };
      if (!res.ok || body.error) return null;
      const settled = applyAvatarPoll(body);
      if (settled) {
        const url =
          body.draft?.preview_url ??
          (body.variants ?? []).find((v) => v.preview_url)?.preview_url ??
          null;
        return url;
      }
      await new Promise((r) => setTimeout(r, TRYON_CLIENT_POLL_MS));
      return pollAvatarJob(jobId, startedAt);
    },
    [applyAvatarPoll, personId],
  );

  const runMint = async () => {
    mintAbortRef.current = false;
    setMessage(null);
    setBusyState(true);
    go("mint");
    setMintBeat(1);
    setMintBeatLabels([false, false, false, false]);

    const markBeat = (i: number) => {
      setMintBeat((i + 1) as 1 | 2 | 3 | 4);
      setMintBeatLabels((prev) => {
        const next = [...prev];
        next[i] = true;
        return next;
      });
    };

    // Kick FASHN generate in parallel with paced atelier beats
    const generatePromise = (async (): Promise<string | null> => {
      if (!photoReady) return null;
      const attrs: AvatarAttributes = {};
      if (heightCm != null) attrs.height_band = heightBandFromCm(heightCm);
      if (build) attrs.build = build;
      if (muscularity) attrs.muscularity = muscularity;
      if (!attrs.height_band) attrs.height_band = heightBandFromCm(175);
      if (!attrs.build) attrs.build = "average";
      if (!attrs.muscularity) attrs.muscularity = "moderate";

      await start();
      if (heightCm != null) {
        await guestFetch("/api/avatar/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "measurements",
            person_id: personId,
            measurements: [{ metric: "height", value: heightCm, unit: "cm" }],
          }),
        });
      }
      const attrRes = await guestFetch("/api/avatar/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "attributes",
          person_id: personId,
          attributes: attrs,
        }),
      });
      const attrBody = await readApiJson(attrRes);
      if (!attrRes.ok || attrBody.error) {
        throw new Error(attrBody.error ?? "Could not save your selections.");
      }

      const res = await guestFetch("/api/avatar/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          person_id: personId,
          action: "generate",
          attributes: attrs,
        }),
      });
      const body = await readApiJson(res);
      if (!res.ok || body.error) {
        throw new Error(body.error ?? "Generation failed.");
      }
      if (body.draft?.compare && body.draft.compare_job_id) {
        return pollAvatarJob(body.draft.compare_job_id, Date.now());
      }
      return body.draft?.preview_url ?? null;
    })();

    // Pace first 3 beats while generate runs — last beat waits for the image.
    const BEAT_MS = 1600;
    let beatIdx = 0;
    const beatTimer = window.setInterval(() => {
      if (beatIdx >= MINT_BEATS.length - 1) {
        window.clearInterval(beatTimer);
        return;
      }
      markBeat(beatIdx);
      beatIdx += 1;
    }, BEAT_MS);

    let preview: string | null = null;
    try {
      preview = await generatePromise;
    } catch (e) {
      window.clearInterval(beatTimer);
      setMessage(
        e instanceof Error && e.message.includes("timed out")
          ? "Generation took too long — try again in a moment."
          : e instanceof Error
            ? e.message
            : "Generation failed.",
      );
      setBusyState(false);
      go("definition");
      return;
    }

    window.clearInterval(beatTimer);

    if (!preview) {
      setMessage("Generation failed — try again with a clearer photo.");
      setBusyState(false);
      go("definition");
      return;
    }

    // Finish remaining ticks, then foil
    for (let i = beatIdx; i < MINT_BEATS.length; i++) {
      markBeat(i);
      await new Promise((r) => setTimeout(r, 450));
    }

    setAvatarUrl(preview);

    const approveRes = await guestFetch("/api/avatar/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        person_id: personId,
        action: "approve",
      }),
    });
    const approveBody = await readApiJson(approveRes);
    let savedUrl = approveBody.avatar?.url ?? null;

    if (!approveRes.ok || approveBody.error || !savedUrl) {
      try {
        const peopleRes = await guestFetch("/api/avatar/people", {
          cache: "no-store",
        });
        if (peopleRes.ok) {
          const peopleJson = (await peopleRes.json()) as {
            people?: Array<{
              id: string;
              has_avatar?: boolean;
              avatar_url?: string | null;
            }>;
          };
          const self =
            peopleJson.people?.find((p) => p.id === personId) ??
            peopleJson.people?.[0];
          if (self?.has_avatar && self.avatar_url) {
            savedUrl = self.avatar_url;
          }
        }
      } catch {
        /* ignore */
      }
    }

    if (!savedUrl) {
      setMessage(
        approveBody.error ??
          "Avatar generated but could not be saved — try Mint again.",
      );
      setBusyState(false);
      go("mint");
      return;
    }

    setAvatarUrl(savedUrl);
    setMinted(true);
    useSelfAvatarStore.getState().markReady(savedUrl);
    void useSelfAvatarStore.getState().refresh();
    void import("@/components/tryon/tryon-drawer-store").then(
      ({ useTryOnDrawerStore }) => {
        useTryOnDrawerStore.setState({
          avatarUrl: savedUrl,
          status: "idle",
          error: null,
        });
      },
    );

    // Hold on mint so the card can paint the real avatar before reveal
    await new Promise((r) => setTimeout(r, 900));
    setBusyState(false);
    go("reveal");
  };

  const skipCurrent = () => {
    if (busy) return;
    if (substep === "photo") go("height");
    else if (substep === "height") go("build");
    else if (substep === "build") go("definition");
    else if (substep === "definition") {
      if (photoReady) go("mint");
      else if (onSkipAll) onSkipAll();
      else go("mint");
    }
  };

  const copy = cardForgeCopy(substep, preferredName);
  const stepMeta =
    substep !== "reveal" ? CARD_FORGE_STEP_META[substep] : null;
  /** Profile / standalone: show titles here. Onboarding gate owns the header. */
  const showHeadings = showStepTag;

  return (
    <div className="grid gap-6 sm:grid-cols-[minmax(0,270px)_1fr] sm:items-start">
      {showStepTag && stepMeta ? (
        <p className="col-span-full text-[10px] font-extrabold tracking-[0.12em] text-neutral-400">
          STEP {stepMeta.n} OF 5 · {stepMeta.label}
          <span className="ml-2 font-semibold tracking-normal text-neutral-500">
            · Clarity {stepMeta.clarity}
          </span>
        </p>
      ) : null}

      <div className="flex justify-center sm:justify-start">
        <ShoopCard
          state={cardState}
          className="hidden sm:block"
          photoBusy={busy && substep === "photo"}
          onPhotoSelect={
            substep === "photo" ? () => fileRef.current?.click() : undefined
          }
          onPhotoFile={
            substep === "photo"
              ? (file) => {
                  void onPhoto(file);
                }
              : undefined
          }
        />
        <ShoopCard
          state={cardState}
          compact
          className="sm:hidden"
          photoBusy={busy && substep === "photo"}
          onPhotoSelect={
            substep === "photo" ? () => fileRef.current?.click() : undefined
          }
          onPhotoFile={
            substep === "photo"
              ? (file) => {
                  void onPhoto(file);
                }
              : undefined
          }
        />
      </div>

      <div className="min-w-0 space-y-4">
        {message ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {message}
          </p>
        ) : null}

        {showHeadings ? (
          <div>
            <h3 className="text-[22px] font-extrabold tracking-tight text-ink">
              {copy.title}
            </h3>
            {copy.subtitle ? (
              <p className="mt-1.5 max-w-md text-[13.5px] leading-6 text-neutral-500">
                {copy.subtitle}
              </p>
            ) : null}
          </div>
        ) : null}

        {substep === "photo" ? (
          <>
            <OnboardingQGroup title="Quick tips" hint="helps the face land clean">
              <div className="flex flex-wrap gap-2">
                {PHOTO_TIPS.map((tip) => {
                  const Icon = tip.icon;
                  return (
                    <div
                      key={tip.title}
                      className="flex min-w-[140px] flex-1 items-start gap-2.5 rounded-xl border border-neutral-200/80 bg-[#F5F3F0] px-3 py-2.5 shadow-[inset_0_2px_5px_rgba(12,12,12,0.07),inset_0_-1px_0_rgba(255,255,255,0.85)]"
                    >
                      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                        <Icon className="size-3.5" aria-hidden />
                      </span>
                      <span>
                        <span className="block text-[13px] font-semibold text-ink">
                          {tip.title}
                        </span>
                        <span className="mt-0.5 block text-[11.5px] text-neutral-400">
                          {tip.body}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </OnboardingQGroup>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onPhoto(f);
                e.target.value = "";
              }}
            />
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
                className={linkBtn}
              >
                {busy ? "Uploading…" : "Add my photo →"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={skipCurrent}
                className={linkMutedBtn}
              >
                Skip for now
              </button>
            </div>
            <p className="text-xs text-neutral-400">
              Your photos train nothing and are sold to no one. Delete anytime.
            </p>
            <OnboardingWhy>
              Skip anytime — a partial card still clears more fog later in
              Settings.
            </OnboardingWhy>
          </>
        ) : null}

        {substep === "height" ? (
          <>
            <OnboardingQGroup title="Your height" hint="drag to lock">
              <div className="max-w-xs space-y-2">
                <input
                  type="range"
                  min={145}
                  max={210}
                  value={heightDraft}
                  onChange={(e) => setHeightDraft(Number(e.target.value))}
                  className="w-full accent-[#007AFF]"
                />
                <div className="text-sm font-semibold tabular-nums text-ink">
                  {heightDraft} cm
                </div>
              </div>
            </OnboardingQGroup>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => {
                  setHeightCm(heightDraft);
                  go("build");
                }}
                className={linkBtn}
              >
                Lock it in →
              </button>
              <button
                type="button"
                onClick={skipCurrent}
                className={linkMutedBtn}
              >
                Skip
              </button>
            </div>
          </>
        ) : null}

        {substep === "build" ? (
          <>
            <OnboardingQGroup title="Build" hint="pick one">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {BUILD_OPTIONS.map((opt) => (
                  <OnboardingTile
                    key={opt.id}
                    selected={(buildDraft ?? build) === opt.id}
                    onClick={() => setBuildDraft(opt.id)}
                    title={opt.label}
                    hint={opt.hint}
                  />
                ))}
              </div>
            </OnboardingQGroup>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                disabled={!buildDraft && !build}
                onClick={() => {
                  const next = buildDraft ?? build;
                  if (!next) return;
                  setBuild(next);
                  go("definition");
                }}
                className={linkBtn}
              >
                Lock it in →
              </button>
              <button
                type="button"
                onClick={skipCurrent}
                className={linkMutedBtn}
              >
                Skip
              </button>
            </div>
          </>
        ) : null}

        {substep === "definition" ? (
          <>
            <OnboardingQGroup title="Definition" hint="pick one">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {MUSCLE_OPTIONS.map((opt) => (
                  <OnboardingTile
                    key={opt.id}
                    selected={(muscleDraft ?? muscularity) === opt.id}
                    onClick={() => setMuscleDraft(opt.id)}
                    title={opt.label}
                    hint={opt.hint}
                  />
                ))}
              </div>
            </OnboardingQGroup>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                disabled={!muscleDraft && !muscularity}
                onClick={() => {
                  const next = muscleDraft ?? muscularity;
                  if (next) setMuscularity(next);
                  go("mint");
                }}
                className={linkBtn}
              >
                Lock it in →
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (photoReady) go("mint");
                  else if (onSkipAll) onSkipAll();
                  else go("mint");
                }}
                className={linkMutedBtn}
              >
                Skip
              </button>
            </div>
          </>
        ) : null}

        {substep === "mint" ? (
          <>
            {!showHeadings && mix.axes.length > 0 ? (
              <p className="max-w-md text-[13.5px] leading-6 text-neutral-500">
                I dress you from your split
                {mix.axes[0] ? `... ${mix.axes[0].label} base` : ""}
                {mix.axes[1] ? `, one ${mix.axes[1].label} statement` : ""}
                {mix.axes[2]
                  ? `, ${mix.axes[2].label} keeping it quiet`
                  : ""}
                .
              </p>
            ) : null}
            <OnboardingQGroup title="Atelier" hint="what happens next">
              <ul className="space-y-1.5 text-sm text-neutral-500">
                {MINT_BEATS.map((label, i) => (
                  <li
                    key={label}
                    className={
                      mintBeatLabels[i]
                        ? "font-medium text-ink"
                        : mintBeat === i + 1
                          ? "font-semibold text-ink"
                          : undefined
                    }
                  >
                    {mintBeatLabels[i] ? (
                      <span className="mr-1.5 text-brand">✓</span>
                    ) : (
                      <span className="mr-1.5 text-neutral-300">·</span>
                    )}
                    {label}
                  </li>
                ))}
              </ul>
            </OnboardingQGroup>
            {!busy ? (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    if (!photoReady) {
                      setMessage(
                        "Add a photo first — mint needs a face to dress.",
                      );
                      go("photo");
                      return;
                    }
                    void runMint();
                  }}
                  className={mintBtn}
                >
                  Mint my card →
                </button>
                {onSkipAll ? (
                  <button
                    type="button"
                    onClick={onSkipAll}
                    className={linkMutedBtn}
                  >
                    Skip for now
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="flex items-center gap-2 text-sm text-neutral-500">
                  <span className="size-4 animate-spin rounded-full border-2 border-brand/25 border-t-brand" />
                  Minting in the atelier…
                </p>
                <p className="text-xs text-neutral-400">
                  This usually takes a little while — ticks advance as we work.
                </p>
              </div>
            )}
          </>
        ) : null}

        {substep === "reveal" ? (
          <>
            <p className="text-sm text-neutral-500">
              First edition № {serial}.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                disabled={exitPhase !== "idle"}
                onClick={() => {
                  void (async () => {
                    setExitPhase("saving");
                    setMessage(null);
                    try {
                      await onComplete();
                      setExitPhase("welcome");
                      await new Promise((r) => setTimeout(r, 1700));
                      onWelcomeDone?.();
                    } catch (e) {
                      setExitPhase("idle");
                      setMessage(
                        e instanceof Error
                          ? e.message
                          : "Could not finish — try again.",
                      );
                    }
                  })();
                }}
                className={linkBtn}
              >
                {exitPhase === "saving"
                  ? "Opening your closet…"
                  : exitPhase === "welcome"
                    ? "Welcome in →"
                    : "Let's find you something →"}
              </button>
              <button
                type="button"
                disabled={exitPhase !== "idle"}
                onClick={() => {
                  setShareFlash(true);
                  window.setTimeout(() => setShareFlash(false), 1800);
                }}
                className={linkMutedBtn}
              >
                Share my card
              </button>
            </div>
            {exitPhase === "welcome" ? (
              <div className="rounded-xl border border-[#CDE8DA] bg-[#F6FBF8] px-4 py-3 text-sm text-ink">
                <p className="font-semibold">You&apos;re in.</p>
                <p className="mt-0.5 text-[13px] text-neutral-500">
                  Welcome to Shoop — your card is saved. Taking you in…
                </p>
              </div>
            ) : null}
            {shareFlash ? (
              <p className="text-xs text-neutral-400">
                Share link coming soon — your card is saved.
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
