"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Camera,
  Check,
  ChevronLeft,
  Sparkles,
  Sun,
  UserRound,
} from "lucide-react";
import type {
  AvatarAttributes,
  AvatarCompareVariant,
  BuildBand,
  HeightBand,
  MuscularityBand,
} from "@/lib/tryon/types";
import { guestFetch } from "@/lib/client/guest-fetch";
import { cn } from "@/lib/ai-chat/cn";
import { isCompareSettled } from "@/lib/tryon/compare-variants";
import {
  TRYON_CLIENT_POLL_MAX_MS,
  TRYON_CLIENT_POLL_MS,
} from "@/lib/tryon/client-poll";
import {
  hasRequiredSilhouetteAttributes,
  missingSilhouetteAttributes,
  SILHOUETTE_LABELS,
} from "@/lib/tryon/avatar/attributes";
import { TryOnLoadingPanel } from "./TryOnLoadingPanel";

type FlowStep =
  | "intro"
  | "photo"
  | "height"
  | "build"
  | "muscularity"
  | "generating"
  | "reveal"
  | "saved";

const ATTRIBUTE_STEPS: FlowStep[] = [
  "photo",
  "height",
  "build",
  "muscularity",
];

const HEIGHT_OPTIONS: {
  id: HeightBand;
  label: string;
  hint: string;
}[] = [
  { id: "under_160", label: "Under 5'3\"", hint: "Petite frame" },
  { id: "160_170", label: "5'3\" – 5'7\"", hint: "Compact" },
  { id: "170_180", label: "5'7\" – 5'11\"", hint: "Most common" },
  { id: "180_190", label: "5'11\" – 6'3\"", hint: "Tall" },
  { id: "over_190", label: "Over 6'3\"", hint: "Very tall" },
];

const BUILD_OPTIONS: {
  id: BuildBand;
  label: string;
  hint: string;
  width: number;
}[] = [
  { id: "slim", label: "Slim", hint: "Narrow through the torso", width: 10 },
  { id: "average", label: "Average", hint: "Balanced everyday build", width: 14 },
  { id: "athletic", label: "Athletic", hint: "Sporty, stronger shoulders", width: 16 },
  { id: "broad", label: "Broad", hint: "Wider chest and frame", width: 18 },
  { id: "plus", label: "Plus", hint: "Fuller, curvier silhouette", width: 20 },
];

const MUSCLE_OPTIONS: {
  id: MuscularityBand;
  label: string;
  hint: string;
}[] = [
  { id: "low", label: "Soft", hint: "Relaxed, natural look" },
  { id: "moderate", label: "Toned", hint: "Light definition" },
  { id: "high", label: "Defined", hint: "Visible muscle shape" },
];

const PHOTO_TIPS = [
  { icon: Sun, text: "Face the light — natural window light is perfect" },
  { icon: UserRound, text: "One person, eyes toward the camera" },
  { icon: Camera, text: "Skip sunglasses, heavy filters, or group shots" },
] as const;

type AvatarStepperProps = {
  personId: string;
  personLabel?: string;
  onComplete?: () => void;
  onBusyChange?: (busy: boolean) => void;
  /** Skip the intro splash (e.g. already explained in onboarding). */
  startAtPhoto?: boolean;
  /** Optional skip control (onboarding). Hidden while generating/saving. */
  onSkip?: () => void;
};

type AvatarApiBody = {
  error?: string;
  avatar?: { url?: string };
  draft?: {
    step?: string;
    preview_url?: string;
    compare?: boolean;
    compare_job_id?: string;
    preview_variants?: AvatarCompareVariant[];
    selected_provider_key?: AvatarCompareVariant["provider_key"];
    intake?: { refusal_message?: string };
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

function ProgressRail({
  current,
}: {
  current: FlowStep;
}) {
  const idx = ATTRIBUTE_STEPS.indexOf(current);
  if (idx < 0) return null;
  return (
    <div className="flex items-center gap-1.5" aria-hidden>
      {ATTRIBUTE_STEPS.map((s, i) => (
        <div
          key={s}
          className={cn(
            "h-1 flex-1 rounded-full transition-colors duration-300",
            i <= idx ? "bg-ink" : "bg-hairline",
          )}
        />
      ))}
    </div>
  );
}

function BodySilhouette({ width }: { width: number }) {
  const torso = width;
  const head = 8;
  return (
    <svg viewBox="0 0 40 72" className="h-14 w-7 text-ink" aria-hidden>
      <ellipse cx="20" cy="10" rx={head} ry="9" fill="currentColor" opacity="0.22" />
      <rect
        x={20 - torso / 2}
        y="20"
        width={torso}
        height="24"
        rx="5"
        fill="currentColor"
        opacity="0.38"
      />
      <rect x="12" y="44" width="6" height="22" rx="2" fill="currentColor" opacity="0.28" />
      <rect x="22" y="44" width="6" height="22" rx="2" fill="currentColor" opacity="0.28" />
    </svg>
  );
}

function ChoiceCard({
  selected,
  onClick,
  title,
  hint,
  children,
  className,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  hint?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex flex-col items-center gap-1.5 rounded-2xl border px-2 py-3 text-center transition duration-200",
        "active:scale-[0.98]",
        selected
          ? "border-ink bg-ink text-white shadow-soft"
          : "border-hairline bg-white text-ink hover:border-ink/25 hover:bg-surface-subtle",
        className,
      )}
    >
      {selected ? (
        <span className="absolute right-2 top-2 flex size-4 items-center justify-center rounded-full bg-white text-ink">
          <Check className="size-2.5" strokeWidth={3} />
        </span>
      ) : null}
      {children}
      <span className="text-xs font-semibold leading-tight">{title}</span>
      {hint ? (
        <span
          className={cn(
            "text-[10px] leading-snug",
            selected ? "text-white/70" : "text-ink-muted",
          )}
        >
          {hint}
        </span>
      ) : null}
    </button>
  );
}

export function AvatarStepper({
  personId,
  personLabel,
  onComplete,
  onBusyChange,
  startAtPhoto = false,
  onSkip,
}: AvatarStepperProps) {
  const [step, setStep] = useState<FlowStep>(startAtPhoto ? "photo" : "intro");
  const [attributes, setAttributes] = useState<Partial<AvatarAttributes>>({});
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [photoReady, setPhotoReady] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const startedRef = useRef(false);

  const setBusyState = useCallback(
    (next: boolean) => {
      setBusy(next);
      onBusyChange?.(next);
    },
    [onBusyChange],
  );

  useEffect(() => {
    return () => {
      if (localPreview) URL.revokeObjectURL(localPreview);
    };
  }, [localPreview]);

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
      setPhotoReady(true);
      setBusyState(false);
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
        setPreviewUrl(selected.preview_url);
        setStep("reveal");
      }
      return isCompareSettled(variants) || Boolean(body.draft?.preview_url);
    },
    [],
  );

  const pollAvatarJob = useCallback(
    async (jobId: string, startedAt: number) => {
      if (Date.now() - startedAt > TRYON_CLIENT_POLL_MAX_MS) {
        setMessage("That took too long — try generating again.");
        setStep("muscularity");
        setBusyState(false);
        return;
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
      if (!res.ok || body.error) {
        setMessage(body.error ?? "Could not check generation status.");
        setStep("muscularity");
        setBusyState(false);
        return;
      }
      const settled = applyAvatarPoll(body);
      if (settled) {
        const hasPreview =
          Boolean(body.draft?.preview_url) ||
          (body.variants ?? []).some((v) => v.preview_url);
        if (!hasPreview) {
          setMessage("Generation failed — try again with a clearer photo.");
          setStep("muscularity");
        }
        setBusyState(false);
        return;
      }
      window.setTimeout(
        () => void pollAvatarJob(jobId, startedAt),
        TRYON_CLIENT_POLL_MS,
      );
    },
    [applyAvatarPoll, personId, setBusyState],
  );

  const generate = async () => {
    if (!photoReady) {
      setMessage("Add a clear face photo first.");
      setStep("photo");
      return;
    }
    if (!hasRequiredSilhouetteAttributes(attributes)) {
      const missing = missingSilhouetteAttributes(attributes).map(
        (k) => SILHOUETTE_LABELS[k],
      );
      setMessage(`Still need: ${missing.join(", ")}.`);
      return;
    }

    setStep("generating");
    setBusyState(true);
    setMessage(null);
    setPreviewUrl(null);

    await start();

    const attrRes = await guestFetch("/api/avatar/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "attributes",
        person_id: personId,
        attributes,
      }),
    });
    const attrBody = await readApiJson(attrRes);
    if (!attrRes.ok || attrBody.error) {
      setMessage(attrBody.error ?? "Could not save your selections.");
      setStep("muscularity");
      setBusyState(false);
      return;
    }

    const res = await guestFetch("/api/avatar/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        person_id: personId,
        action: "generate",
        attributes,
      }),
    });
    const body = await readApiJson(res);
    if (!res.ok || body.error) {
      setMessage(
        body.error?.includes("timed out")
          ? "Generation took too long — try again in a moment."
          : (body.error ?? "Generation failed."),
      );
      setStep("muscularity");
      setBusyState(false);
      return;
    }

    if (body.draft?.compare && body.draft.compare_job_id) {
      void pollAvatarJob(body.draft.compare_job_id, Date.now());
      return;
    }

    if (body.draft?.preview_url) {
      setPreviewUrl(body.draft.preview_url);
      setStep("reveal");
      setBusyState(false);
      return;
    }

    setMessage("Generation failed.");
    setStep("muscularity");
    setBusyState(false);
  };

  const approve = async () => {
    setBusyState(true);
    const res = await guestFetch("/api/avatar/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        person_id: personId,
        action: "approve",
      }),
    });
    const body = await readApiJson(res);
    if (!res.ok || body.error) {
      setMessage(body.error ?? "Could not save avatar.");
      setBusyState(false);
      return;
    }
    if (body.avatar?.url) setPreviewUrl(body.avatar.url);
    setStep("saved");
    setBusyState(false);
    window.setTimeout(() => onComplete?.(), 1200);
  };

  const stepTitle = useMemo(() => {
    switch (step) {
      case "intro":
        return "Your digital twin";
      case "photo":
        return "Start with your face";
      case "height":
        return "How tall are you?";
      case "build":
        return "What’s your build?";
      case "muscularity":
        return "Muscle definition";
      case "generating":
        return "Crafting your avatar";
      case "reveal":
        return "Meet your avatar";
      case "saved":
        return "You’re ready";
      default:
        return "";
    }
  }, [step]);

  const goBack = () => {
    const order: FlowStep[] = [
      "intro",
      "photo",
      "height",
      "build",
      "muscularity",
    ];
    const i = order.indexOf(step);
    if (i > 0) setStep(order[i - 1]!);
  };

  const canBack =
    !busy &&
    (step === "photo" ||
      step === "height" ||
      step === "build" ||
      step === "muscularity" ||
      step === "reveal");

  return (
    <div className="space-y-5">
      {step !== "intro" && step !== "saved" ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            {canBack ? (
              <button
                type="button"
                onClick={() => {
                  if (step === "reveal") {
                    setStep("muscularity");
                    return;
                  }
                  goBack();
                }}
                className="inline-flex size-8 items-center justify-center rounded-full text-ink-muted transition hover:bg-surface-subtle hover:text-ink"
                aria-label="Back"
              >
                <ChevronLeft className="size-4" />
              </button>
            ) : (
              <span className="size-8" />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-serif text-lg font-semibold leading-tight text-ink">
                {stepTitle}
              </p>
              {personLabel ? (
                <p className="truncate text-xs text-ink-muted">For you</p>
              ) : null}
            </div>
          </div>
          {ATTRIBUTE_STEPS.includes(step) ? <ProgressRail current={step} /> : null}
        </div>
      ) : null}

      {message ? (
        <p className="rounded-2xl bg-error-bg px-3.5 py-2.5 text-sm text-error-deep">
          {message}
        </p>
      ) : null}

      {step === "intro" ? (
        <div className="space-y-6 py-2 text-center">
          <div className="mx-auto flex size-16 items-center justify-center rounded-3xl bg-surface-tint ring-1 ring-hairline">
            <Sparkles className="size-7 text-ink" />
          </div>
          <div className="space-y-2">
            <h3 className="font-serif text-2xl font-semibold tracking-tight text-ink">
              Your digital twin
            </h3>
            <p className="mx-auto max-w-sm text-sm leading-relaxed text-ink-secondary">
              One great photo + a few quick vibe checks. We’ll build a try-on
              avatar that looks like you — so outfits preview honestly.
            </p>
          </div>
          <ul className="mx-auto max-w-xs space-y-2 text-left text-xs text-ink-muted">
            <li className="flex gap-2">
              <Check className="mt-0.5 size-3.5 shrink-0 text-ink" />
              Takes about a minute
            </li>
            <li className="flex gap-2">
              <Check className="mt-0.5 size-3.5 shrink-0 text-ink" />
              Face stays private — used only for your avatar
            </li>
            <li className="flex gap-2">
              <Check className="mt-0.5 size-3.5 shrink-0 text-ink" />
              You approve before it’s saved
            </li>
          </ul>
          <button
            type="button"
            className="btn-primary w-full"
            onClick={() => setStep("photo")}
          >
            Let’s make my avatar
          </button>
          {onSkip ? (
            <button
              type="button"
              className="text-sm font-medium text-ink-muted underline-offset-2 hover:underline"
              onClick={onSkip}
            >
              Skip for now
            </button>
          ) : null}
        </div>
      ) : null}

      {step === "photo" ? (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-ink-secondary">
            A clear selfie is the #1 ingredient. Face, hair, and skin tone
            come from the photo — next we only ask about body shape.
          </p>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="user"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onPhoto(f);
            }}
          />

          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className={cn(
              "relative flex w-full flex-col items-center justify-center overflow-hidden rounded-3xl border-2 border-dashed transition",
              localPreview
                ? "border-ink/20 bg-surface-subtle"
                : "border-hairline bg-gradient-to-b from-white to-surface-subtle hover:border-ink/30",
              "min-h-[220px] active:scale-[0.995] disabled:opacity-60",
            )}
          >
            {localPreview ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={localPreview}
                  alt="Your photo"
                  className="absolute inset-0 h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-ink/55 via-transparent to-transparent" />
                <div className="relative z-10 mt-auto w-full p-4 text-left">
                  <p className="text-sm font-semibold text-white">
                    {photoReady ? "Looking good" : busy ? "Uploading…" : "Photo selected"}
                  </p>
                  <p className="text-xs text-white/75">Tap to choose a different shot</p>
                </div>
              </>
            ) : (
              <div className="space-y-3 px-6 py-8 text-center">
                <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-white shadow-soft ring-1 ring-hairline">
                  <Camera className="size-6 text-ink" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-ink">Add a face photo</p>
                  <p className="mt-1 text-xs text-ink-muted">
                    Selfie or headshot · JPG/PNG
                  </p>
                </div>
              </div>
            )}
          </button>

          <div className="space-y-2 rounded-2xl bg-surface-subtle/80 px-3.5 py-3">
            {PHOTO_TIPS.map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-start gap-2.5 text-xs text-ink-secondary">
                <Icon className="mt-0.5 size-3.5 shrink-0 text-ink-muted" />
                <span>{text}</span>
              </div>
            ))}
          </div>

          <button
            type="button"
            className="btn-primary w-full"
            disabled={busy || !photoReady}
            onClick={() => setStep("height")}
          >
            {busy ? "Uploading…" : "Next — body shape"}
          </button>
          {onSkip && !busy ? (
            <button
              type="button"
              className="w-full text-center text-sm font-medium text-ink-muted underline-offset-2 hover:underline"
              onClick={onSkip}
            >
              Skip for now
            </button>
          ) : null}
        </div>
      ) : null}

      {step === "height" ? (
        <div className="space-y-4">
          <p className="text-sm text-ink-secondary">
            Helps scale proportions so clothes sit right on you.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {HEIGHT_OPTIONS.map((opt) => (
              <ChoiceCard
                key={opt.id}
                selected={attributes.height_band === opt.id}
                onClick={() => {
                  setAttributes((a) => ({ ...a, height_band: opt.id }));
                  window.setTimeout(() => setStep("build"), 180);
                }}
                title={opt.label}
                hint={opt.hint}
                className="items-start px-4 py-3.5 text-left sm:col-span-1"
              />
            ))}
          </div>
        </div>
      ) : null}

      {step === "build" ? (
        <div className="space-y-4">
          <p className="text-sm text-ink-secondary">
            Pick the silhouette closest to you — honesty beats flattery for
            better try-ons.
          </p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {BUILD_OPTIONS.map((opt) => (
              <ChoiceCard
                key={opt.id}
                selected={attributes.build === opt.id}
                onClick={() => {
                  setAttributes((a) => ({ ...a, build: opt.id }));
                  window.setTimeout(() => setStep("muscularity"), 180);
                }}
                title={opt.label}
                hint={opt.hint}
              >
                <BodySilhouette width={opt.width} />
              </ChoiceCard>
            ))}
          </div>
        </div>
      ) : null}

      {step === "muscularity" ? (
        <div className="space-y-4">
          <p className="text-sm text-ink-secondary">
            How defined is your body under clothes? Soft is totally fine.
          </p>
          <div className="grid grid-cols-3 gap-2">
            {MUSCLE_OPTIONS.map((opt) => (
              <ChoiceCard
                key={opt.id}
                selected={attributes.muscularity === opt.id}
                onClick={() =>
                  setAttributes((a) => ({ ...a, muscularity: opt.id }))
                }
                title={opt.label}
                hint={opt.hint}
              />
            ))}
          </div>
          <p className="text-xs text-ink-muted">
            Face, hair, and skin come from your photo — we only use these picks
            for body shape.
          </p>
          <button
            type="button"
            className="btn-primary w-full gap-2"
            disabled={busy || !hasRequiredSilhouetteAttributes(attributes)}
            onClick={() => void generate()}
          >
            <Sparkles className="size-4" />
            Create my avatar
          </button>
          {onSkip && !busy ? (
            <button
              type="button"
              className="w-full text-center text-sm font-medium text-ink-muted underline-offset-2 hover:underline"
              onClick={onSkip}
            >
              Skip for now
            </button>
          ) : null}
          {!hasRequiredSilhouetteAttributes(attributes) ? (
            <p className="text-center text-xs text-ink-muted">
              Missing{" "}
              {missingSilhouetteAttributes(attributes)
                .map((k) => SILHOUETTE_LABELS[k])
                .join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}

      {step === "generating" ? (
        <TryOnLoadingPanel variant="avatar-generate" />
      ) : null}

      {step === "reveal" && previewUrl ? (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-3xl bg-gradient-to-b from-surface-subtle to-white ring-1 ring-hairline">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt="Avatar preview"
              className="mx-auto max-h-[360px] w-full object-contain"
            />
          </div>
          <p className="text-center text-xs text-ink-muted">
            AI visualization — fit and details are approximate. If the vibe’s
            off, regenerate or tweak your shape.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary h-11 flex-1 text-sm"
              disabled={busy}
              onClick={() => void generate()}
            >
              Regenerate
            </button>
            <button
              type="button"
              className="btn-primary h-11 flex-1 text-sm"
              disabled={busy}
              onClick={() => void approve()}
            >
              Looks like me
            </button>
          </div>
          <button
            type="button"
            className="w-full text-center text-xs font-medium text-ink-muted underline-offset-2 hover:underline"
            disabled={busy}
            onClick={() => setStep("height")}
          >
            Adjust body shape
          </button>
        </div>
      ) : null}

      {step === "saved" && previewUrl ? (
        <div className="space-y-4 py-2 text-center">
          <div className="mx-auto overflow-hidden rounded-3xl ring-1 ring-hairline">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt="Saved avatar"
              className="mx-auto max-h-56 w-full object-contain"
            />
          </div>
          <div>
            <p className="font-serif text-xl font-semibold text-ink">
              Avatar locked in
            </p>
            <p className="mt-1 text-sm text-ink-muted">
              You’re set for virtual try-on in search results.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
