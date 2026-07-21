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
  ChevronDown,
  ChevronLeft,
  Ruler,
  Sparkles,
  Sun,
  UserRound,
} from "lucide-react";
import type {
  AvatarAttributes,
  AvatarCompareVariant,
  BodyShapeBand,
  BuildBand,
  BustFullnessBand,
  MuscularityBand,
} from "@/lib/tryon/types";
import type { FashionFactMeasurementMetric } from "@/lib/fashion-memory/types";
import { guestFetch } from "@/lib/client/guest-fetch";
import { cn } from "@/lib/ai-chat/cn";
import { isCompareSettled } from "@/lib/tryon/compare-variants";
import {
  TRYON_CLIENT_POLL_MAX_MS,
  TRYON_CLIENT_POLL_MS,
} from "@/lib/tryon/client-poll";
import {
  BODY_SHAPE_LABELS,
  BUST_FULLNESS_LABELS,
  hasRequiredSilhouetteAttributes,
  missingSilhouetteAttributes,
  SILHOUETTE_LABELS,
} from "@/lib/tryon/avatar/attributes";
import { TryOnLoadingPanel } from "./TryOnLoadingPanel";
import {
  BodyShapeSilhouette,
  BuildSilhouette,
  BustFullnessSilhouette,
} from "./avatar-silhouettes";

type FlowPath = "quick" | "tailored";

type FlowStep =
  | "intro"
  | "photo"
  | "path"
  | "height"
  | "build"
  | "body_shape"
  | "bust_fullness"
  | "muscularity"
  | "measurements"
  | "review"
  | "generating"
  | "reveal"
  | "saved";

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

const BODY_SHAPE_OPTIONS: {
  id: BodyShapeBand;
  label: string;
}[] = [
  { id: "rectangle", label: BODY_SHAPE_LABELS.rectangle },
  { id: "triangle", label: BODY_SHAPE_LABELS.triangle },
  { id: "inverted_triangle", label: BODY_SHAPE_LABELS.inverted_triangle },
  { id: "hourglass", label: BODY_SHAPE_LABELS.hourglass },
  { id: "oval", label: BODY_SHAPE_LABELS.oval },
];

const BUST_OPTIONS: {
  id: BustFullnessBand;
  label: string;
}[] = [
  { id: "subtle", label: BUST_FULLNESS_LABELS.subtle },
  { id: "average", label: BUST_FULLNESS_LABELS.average },
  { id: "full", label: BUST_FULLNESS_LABELS.full },
  { id: "very_full", label: BUST_FULLNESS_LABELS.very_full },
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

const MEASUREMENT_FIELDS: {
  metric: FashionFactMeasurementMetric;
  label: string;
}[] = [
  { metric: "neck", label: "Neck" },
  { metric: "chest", label: "Chest / bust" },
  { metric: "waist", label: "Waist" },
  { metric: "hips", label: "Hips" },
  { metric: "inseam", label: "Inseam" },
];

const PHOTO_TIPS = [
  { icon: Sun, text: "Face the light — natural window light is perfect" },
  { icon: UserRound, text: "One person, eyes toward the camera" },
  { icon: Camera, text: "Skip sunglasses, heavy filters, or group shots" },
] as const;

type MeasurementDraft = Partial<
  Record<
    FashionFactMeasurementMetric,
    { value: string; unit: MeasurementUnit }
  >
>;

type MeasurementUnit = "cm" | "in";

function heightBandFromInput(
  raw: string,
  unit: MeasurementUnit,
): AvatarAttributes["height_band"] | undefined {
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  const cm = unit === "cm" ? value : value * 2.54;
  if (cm < 90 || cm > 250) return undefined;
  if (cm < 160) return "under_160";
  if (cm < 170) return "160_170";
  if (cm < 180) return "170_180";
  if (cm < 190) return "180_190";
  return "over_190";
}

type AvatarStepperProps = {
  personId: string;
  personLabel?: string;
  onComplete?: () => void;
  onBusyChange?: (busy: boolean) => void;
  /** Skip the intro splash (e.g. already explained in onboarding). */
  startAtPhoto?: boolean;
  /** Optional skip control (onboarding). Hidden while generating/saving. */
  onSkip?: () => void;
  /** When true, show bust fullness on Tailored path. */
  womensDepartment?: boolean;
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
    intake?: {
      refusal_message?: string;
      clear?: Partial<AvatarAttributes>;
      body_inference_attempted?: boolean;
    };
    attributes?: Partial<AvatarAttributes>;
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
  steps,
  current,
}: {
  steps: FlowStep[];
  current: FlowStep;
}) {
  const idx = steps.indexOf(current);
  if (idx < 0) return null;
  return (
    <div className="flex items-center gap-1.5" aria-hidden>
      {steps.map((s, i) => (
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

function ChoiceCard({
  selected,
  onClick,
  title,
  hint,
  children,
  className,
  suggested,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  hint?: string;
  children?: ReactNode;
  className?: string;
  suggested?: boolean;
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
      ) : suggested ? (
        <span className="absolute right-2 top-2 rounded-full bg-surface-tint px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-ink-muted">
          Suggested
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

function SectionHonesty({
  title,
  help,
}: {
  title: string;
  help: string;
}) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink">
        {title}
      </p>
      <p className="text-xs text-ink-muted">{help}</p>
    </div>
  );
}

export function AvatarStepper({
  personId,
  personLabel,
  onComplete,
  onBusyChange,
  startAtPhoto = false,
  onSkip,
  womensDepartment: womensProp,
}: AvatarStepperProps) {
  const [step, setStep] = useState<FlowStep>(startAtPhoto ? "photo" : "intro");
  const [path, setPath] = useState<FlowPath | null>(null);
  const [attributes, setAttributes] = useState<Partial<AvatarAttributes>>({});
  const [suggestedBodyShape, setSuggestedBodyShape] =
    useState<BodyShapeBand | null>(null);
  const [womensDepartment, setWomensDepartment] = useState(Boolean(womensProp));
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [photoReady, setPhotoReady] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [measurementsOpen, setMeasurementsOpen] = useState(false);
  const [heightDraft, setHeightDraft] = useState("");
  const [heightUnit, setHeightUnit] = useState<MeasurementUnit>("cm");
  const [measurementDraft, setMeasurementDraft] = useState<MeasurementDraft>({});
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

  useEffect(() => {
    if (womensProp != null) {
      setWomensDepartment(womensProp);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await guestFetch("/api/avatar/people");
        if (!res.ok) return;
        const body = (await res.json()) as {
          people?: Array<{ id: string; department?: string | null }>;
        };
        const me = body.people?.find((p) => p.id === personId);
        if (!cancelled && me?.department === "womens") {
          setWomensDepartment(true);
        }
      } catch {
        /* optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [personId, womensProp]);

  const attributeSteps = useMemo((): FlowStep[] => {
    if (path === "tailored") {
      const steps: FlowStep[] = [
        "photo",
        "path",
        "height",
        "build",
        "body_shape",
      ];
      if (womensDepartment) steps.push("bust_fullness");
      steps.push("muscularity", "measurements", "review");
      return steps;
    }
    if (path === "quick") {
      return ["photo", "path", "height", "build", "muscularity"];
    }
    return ["photo", "path"];
  }, [path, womensDepartment]);

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
    setSuggestedBodyShape(null);

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

      // Vision attribute check — may pre-fill body_shape for full-body photos
      const checkRes = await guestFetch("/api/avatar/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check", person_id: personId }),
      });
      const checkBody = await readApiJson(checkRes);
      if (checkBody.draft?.step === "refused_minor") {
        setMessage(
          checkBody.draft.intake?.refusal_message ?? "We can't use this photo.",
        );
        setBusyState(false);
        return;
      }
      const suggested =
        checkBody.draft?.intake?.clear?.body_shape ??
        checkBody.draft?.attributes?.body_shape;
      if (suggested) {
        setSuggestedBodyShape(suggested);
        setAttributes((a) => ({ ...a, body_shape: suggested }));
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

  const fallbackAfterFail = path === "tailored" ? "review" : "muscularity";

  const pollAvatarJob = useCallback(
    async (jobId: string, startedAt: number) => {
      if (Date.now() - startedAt > TRYON_CLIENT_POLL_MAX_MS) {
        setMessage("That took too long — try generating again.");
        setStep(fallbackAfterFail);
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
        setStep(fallbackAfterFail);
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
          setStep(fallbackAfterFail);
        }
        setBusyState(false);
        return;
      }
      window.setTimeout(
        () => void pollAvatarJob(jobId, startedAt),
        TRYON_CLIENT_POLL_MS,
      );
    },
    [applyAvatarPoll, fallbackAfterFail, personId, setBusyState],
  );

  const filledMeasurements = useMemo(() => {
    const out: Array<{
      metric: FashionFactMeasurementMetric;
      value: number;
      unit: MeasurementUnit;
    }> = [];
    const height = Number.parseFloat(heightDraft.trim());
    if (
      heightBandFromInput(heightDraft, heightUnit) &&
      Number.isFinite(height)
    ) {
      out.push({ metric: "height", value: height, unit: heightUnit });
    }
    for (const { metric } of MEASUREMENT_FIELDS) {
      const draft = measurementDraft[metric];
      if (!draft) continue;
      const raw = draft.value.trim();
      if (!raw) continue;
      const value = Number.parseFloat(raw);
      if (!Number.isFinite(value) || value <= 0) continue;
      out.push({ metric, value, unit: draft.unit });
    }
    return out;
  }, [heightDraft, heightUnit, measurementDraft]);

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
    if (path === "tailored" && !attributes.body_shape) {
      setMessage("Pick a body shape for your avatar.");
      setStep("body_shape");
      return;
    }

    setStep("generating");
    setBusyState(true);
    setMessage(null);
    setPreviewUrl(null);

    await start();

    // Shopping-side measurements — never sent to the image generator.
    // Exact height is stored on both paths; Tailored can add the remaining fields.
    if (filledMeasurements.length > 0) {
      await guestFetch("/api/avatar/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "measurements",
          person_id: personId,
          measurements: filledMeasurements,
        }),
      });
    }

    const attrsForGenerate: AvatarAttributes = { ...attributes };
    if (path === "quick") {
      delete attrsForGenerate.body_shape;
      delete attrsForGenerate.bust_fullness;
    }

    const attrRes = await guestFetch("/api/avatar/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "attributes",
        person_id: personId,
        attributes: attrsForGenerate,
      }),
    });
    const attrBody = await readApiJson(attrRes);
    if (!attrRes.ok || attrBody.error) {
      setMessage(attrBody.error ?? "Could not save your selections.");
      setStep(fallbackAfterFail);
      setBusyState(false);
      return;
    }

    const res = await guestFetch("/api/avatar/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        person_id: personId,
        action: "generate",
        attributes: attrsForGenerate,
      }),
    });
    const body = await readApiJson(res);
    if (!res.ok || body.error) {
      setMessage(
        body.error?.includes("timed out")
          ? "Generation took too long — try again in a moment."
          : (body.error ?? "Generation failed."),
      );
      setStep(fallbackAfterFail);
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
    setStep(fallbackAfterFail);
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

  const nextAfterBuild = () => {
    if (path === "tailored") setStep("body_shape");
    else setStep("muscularity");
  };

  const nextAfterBodyShape = () => {
    if (womensDepartment) setStep("bust_fullness");
    else setStep("muscularity");
  };

  const nextAfterMuscle = () => {
    if (path === "tailored") setStep("measurements");
    else void generate();
  };

  const stepTitle = useMemo(() => {
    switch (step) {
      case "intro":
        return "Your digital twin";
      case "photo":
        return "Start with your face";
      case "path":
        return "How detailed?";
      case "height":
        return "How tall are you?";
      case "build":
        return "What’s your build?";
      case "body_shape":
        return "Body shape";
      case "bust_fullness":
        return "Bust fullness";
      case "muscularity":
        return "Muscle definition";
      case "measurements":
        return "Precise measurements";
      case "review":
        return "Review";
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

  const stepOrder = useMemo((): FlowStep[] => {
    const base: FlowStep[] = ["intro", "photo", "path", "height", "build"];
    if (path === "tailored") {
      base.push("body_shape");
      if (womensDepartment) base.push("bust_fullness");
      base.push("muscularity", "measurements", "review");
    } else {
      base.push("muscularity");
    }
    return base;
  }, [path, womensDepartment]);

  const goBack = () => {
    const i = stepOrder.indexOf(step);
    if (i > 0) setStep(stepOrder[i - 1]!);
  };

  const canBack =
    !busy &&
    step !== "intro" &&
    step !== "generating" &&
    step !== "saved" &&
    (step === "reveal" || stepOrder.includes(step));

  const heightLabel = heightDraft.trim()
    ? `${heightDraft.trim()} ${heightUnit}`
    : "—";
  const buildLabel =
    BUILD_OPTIONS.find((o) => o.id === attributes.build)?.label ?? "—";
  const muscleLabel =
    MUSCLE_OPTIONS.find((o) => o.id === attributes.muscularity)?.label ?? "—";

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
                    setStep(fallbackAfterFail);
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
          {attributeSteps.includes(step) ? (
            <ProgressRail steps={attributeSteps} current={step} />
          ) : null}
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
              One great photo + a few shape checks. We’ll build a try-on avatar
              that looks like you — so outfits preview honestly.
            </p>
          </div>
          <ul className="mx-auto max-w-xs space-y-2 text-left text-xs text-ink-muted">
            <li className="flex gap-2">
              <Check className="mt-0.5 size-3.5 shrink-0 text-ink" />
              Takes about a minute
            </li>
            <li className="flex gap-2">
              <Check className="mt-0.5 size-3.5 shrink-0 text-ink" />
              Shape picks change the avatar; measurements never do
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
            A clear selfie is the #1 ingredient. Face, hair, and skin tone come
            from the photo — next we only ask about body shape.
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
                    {photoReady
                      ? "Looking good"
                      : busy
                        ? "Uploading…"
                        : "Photo selected"}
                  </p>
                  <p className="text-xs text-white/75">
                    Tap to choose a different shot
                  </p>
                </div>
              </>
            ) : (
              <div className="space-y-3 px-6 py-8 text-center">
                <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-white shadow-soft ring-1 ring-hairline">
                  <Camera className="size-6 text-ink" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-ink">
                    Add a face photo
                  </p>
                  <p className="mt-1 text-xs text-ink-muted">
                    Selfie or headshot · JPG/PNG
                  </p>
                </div>
              </div>
            )}
          </button>

          <div className="space-y-2 rounded-2xl bg-surface-subtle/80 px-3.5 py-3">
            {PHOTO_TIPS.map(({ icon: Icon, text }) => (
              <div
                key={text}
                className="flex items-start gap-2.5 text-xs text-ink-secondary"
              >
                <Icon className="mt-0.5 size-3.5 shrink-0 text-ink-muted" />
                <span>{text}</span>
              </div>
            ))}
          </div>

          <button
            type="button"
            className="btn-primary w-full"
            disabled={busy || !photoReady}
            onClick={() => setStep("path")}
          >
            {busy ? "Uploading…" : "Next"}
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

      {step === "path" ? (
        <div className="space-y-3">
          <p className="text-sm text-ink-secondary">
            Quick covers the essentials. Tailored adds shape detail — and
            optional measurements for size-matching later.
          </p>
          <button
            type="button"
            onClick={() => {
              setPath("quick");
              window.setTimeout(() => setStep("height"), 120);
            }}
            className="w-full rounded-2xl border border-hairline bg-white px-4 py-4 text-left transition hover:border-ink/25 hover:bg-surface-subtle active:scale-[0.99]"
          >
            <p className="text-sm font-semibold text-ink">Quick</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              Height, build, muscle — about 30 seconds
            </p>
          </button>
          <button
            type="button"
            onClick={() => {
              setPath("tailored");
              window.setTimeout(() => setStep("height"), 120);
            }}
            className="w-full rounded-2xl border border-ink/15 bg-gradient-to-br from-white to-surface-subtle px-4 py-4 text-left shadow-soft transition hover:border-ink/30 active:scale-[0.99]"
          >
            <p className="text-sm font-semibold text-ink">Tailored</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              Body shape{womensDepartment ? ", bust," : ""} and optional
              measurements for perfect size-matching later
            </p>
          </button>
        </div>
      ) : null}

      {step === "height" ? (
        <div className="space-y-4">
          <SectionHonesty
            title="Shape your avatar"
            help="these change how your avatar looks."
          />
          <p className="text-sm text-ink-secondary">
            Helps scale proportions so clothes sit right on you.
          </p>
          <div className="rounded-2xl border border-hairline bg-white p-4">
            <label className="block text-xs font-medium text-ink-muted" htmlFor="avatar-height">
              Your height
            </label>
            <div className="mt-2 flex gap-2">
              <input
                id="avatar-height"
                type="number"
                inputMode="decimal"
                min={heightUnit === "cm" ? 90 : 36}
                max={heightUnit === "cm" ? 250 : 98}
                step="any"
                placeholder={heightUnit === "cm" ? "175" : "69"}
                value={heightDraft}
                onChange={(event) => {
                  setHeightDraft(event.target.value);
                  setMessage(null);
                }}
                className="h-12 min-w-0 flex-1 rounded-xl border border-hairline bg-surface-subtle/50 px-3 text-base text-ink outline-none transition focus:border-ink/30 focus:bg-white"
              />
              <select
                aria-label="Height unit"
                value={heightUnit}
                onChange={(event) =>
                  setHeightUnit(event.target.value as MeasurementUnit)
                }
                className="h-12 rounded-xl border border-hairline bg-white px-3 text-sm font-medium text-ink outline-none transition focus:border-ink/30"
              >
                <option value="cm">cm</option>
                <option value="in">in</option>
              </select>
            </div>
            <p className="mt-2 text-xs text-ink-muted">
              Enter any value in centimeters or inches.
            </p>
          </div>
          <button
            type="button"
            className="btn-primary w-full"
            disabled={!heightBandFromInput(heightDraft, heightUnit)}
            onClick={() => {
              const heightBand = heightBandFromInput(heightDraft, heightUnit);
              if (!heightBand) {
                setMessage("Enter a valid height.");
                return;
              }
              setAttributes((current) => ({
                ...current,
                height_band: heightBand,
              }));
              setStep("build");
            }}
          >
            Continue
          </button>
        </div>
      ) : null}

      {step === "build" ? (
        <div className="space-y-4">
          <SectionHonesty
            title="Shape your avatar"
            help="these change how your avatar looks."
          />
          <p className="text-sm text-ink-secondary">
            Overall scale — honesty beats flattery for better try-ons.
            {path === "tailored"
              ? " Next you’ll pick how that mass is distributed."
              : ""}
          </p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {BUILD_OPTIONS.map((opt) => (
              <ChoiceCard
                key={opt.id}
                selected={attributes.build === opt.id}
                onClick={() => {
                  setAttributes((a) => ({ ...a, build: opt.id }));
                  window.setTimeout(() => nextAfterBuild(), 180);
                }}
                title={opt.label}
                hint={opt.hint}
              >
                <BuildSilhouette width={opt.width} />
              </ChoiceCard>
            ))}
          </div>
        </div>
      ) : null}

      {step === "body_shape" ? (
        <div className="space-y-4">
          <SectionHonesty
            title="Shape your avatar"
            help="these change how your avatar looks."
          />
          <p className="text-sm text-ink-secondary">
            How weight sits on your frame — complements overall build scale.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {BODY_SHAPE_OPTIONS.map((opt) => (
              <ChoiceCard
                key={opt.id}
                selected={attributes.body_shape === opt.id}
                suggested={
                  suggestedBodyShape === opt.id &&
                  attributes.body_shape === opt.id
                }
                onClick={() => {
                  setAttributes((a) => ({ ...a, body_shape: opt.id }));
                  window.setTimeout(() => nextAfterBodyShape(), 180);
                }}
                title={opt.label}
                className="min-h-[7.5rem] justify-center px-2"
              >
                <BodyShapeSilhouette shape={opt.id} />
              </ChoiceCard>
            ))}
          </div>
        </div>
      ) : null}

      {step === "bust_fullness" ? (
        <div className="space-y-4">
          <SectionHonesty
            title="Shape your avatar"
            help="these change how your avatar looks."
          />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {BUST_OPTIONS.map((opt) => (
              <ChoiceCard
                key={opt.id}
                selected={attributes.bust_fullness === opt.id}
                onClick={() => {
                  setAttributes((a) => ({ ...a, bust_fullness: opt.id }));
                  window.setTimeout(() => setStep("muscularity"), 180);
                }}
                title={opt.label}
                className="min-h-[7rem] justify-center"
              >
                <BustFullnessSilhouette band={opt.id} />
              </ChoiceCard>
            ))}
          </div>
        </div>
      ) : null}

      {step === "muscularity" ? (
        <div className="space-y-4">
          <SectionHonesty
            title="Shape your avatar"
            help="these change how your avatar looks."
          />
          <p className="text-sm text-ink-secondary">
            How defined is your body under clothes? Soft is totally fine.
          </p>
          <div className="grid grid-cols-3 gap-2">
            {MUSCLE_OPTIONS.map((opt) => (
              <ChoiceCard
                key={opt.id}
                selected={attributes.muscularity === opt.id}
                onClick={() => {
                  setAttributes((a) => ({ ...a, muscularity: opt.id }));
                  if (path === "tailored") {
                    window.setTimeout(() => nextAfterMuscle(), 180);
                  }
                }}
                title={opt.label}
                hint={opt.hint}
              />
            ))}
          </div>
          {path === "quick" ? (
            <>
              <p className="text-xs text-ink-muted">
                Face, hair, and skin come from your photo — we only use these
                picks for body shape.
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
            </>
          ) : attributes.muscularity ? (
            <button
              type="button"
              className="btn-primary w-full"
              onClick={() => nextAfterMuscle()}
            >
              Continue
            </button>
          ) : null}
          {onSkip && !busy && path === "quick" ? (
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

      {step === "measurements" ? (
        <div className="space-y-4">
          <SectionHonesty
            title="Shopping fit"
            help="these power fit-checked shopping — they don't change the image."
          />

          <div className="overflow-hidden rounded-2xl border border-hairline bg-white">
            <button
              type="button"
              onClick={() => setMeasurementsOpen((o) => !o)}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-surface-subtle/60"
            >
              <span className="flex size-9 items-center justify-center rounded-xl bg-surface-subtle text-ink">
                <Ruler className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink">
                  Precise measurements (optional — for perfect size-matching
                  later)
                </span>
              </span>
              <ChevronDown
                className={cn(
                  "size-4 shrink-0 text-ink-muted transition",
                  measurementsOpen && "rotate-180",
                )}
              />
            </button>

            {measurementsOpen ? (
              <div className="space-y-3 border-t border-hairline-soft px-4 pb-4 pt-3">
                <p className="text-xs leading-relaxed text-ink-secondary">
                  These never change your avatar — they let Shoop match you
                  against brand size charts, so a find can say &apos;in this
                  brand you&apos;re an L&apos;.
                </p>
                <div className="space-y-2">
                  {MEASUREMENT_FIELDS.map(({ metric, label }) => (
                    <label
                      key={metric}
                      className="flex items-center gap-3 text-sm"
                    >
                      <span className="w-24 shrink-0 text-ink-secondary">
                        {label}
                      </span>
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="any"
                        placeholder="—"
                        value={measurementDraft[metric]?.value ?? ""}
                        onChange={(e) =>
                          setMeasurementDraft((d) => ({
                            ...d,
                            [metric]: {
                              value: e.target.value,
                              unit: d[metric]?.unit ?? "cm",
                            },
                          }))
                        }
                        className="h-10 flex-1 rounded-xl border border-hairline bg-surface-subtle/50 px-3 text-ink outline-none transition focus:border-ink/30 focus:bg-white"
                      />
                      <select
                        aria-label={`${label} unit`}
                        value={measurementDraft[metric]?.unit ?? "cm"}
                        onChange={(event) =>
                          setMeasurementDraft((draft) => ({
                            ...draft,
                            [metric]: {
                              value: draft[metric]?.value ?? "",
                              unit: event.target.value as MeasurementUnit,
                            },
                          }))
                        }
                        className="h-10 rounded-xl border border-hairline bg-white px-2 text-xs font-medium text-ink outline-none transition focus:border-ink/30"
                      >
                        <option value="cm">cm</option>
                        <option value="in">in</option>
                      </select>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <button
            type="button"
            className="btn-primary w-full"
            onClick={() => setStep("review")}
          >
            Continue to review
          </button>
          <button
            type="button"
            className="w-full text-center text-sm font-medium text-ink-muted underline-offset-2 hover:underline"
            onClick={() => {
              setMeasurementDraft({});
              setStep("review");
            }}
          >
            Skip measurements
          </button>
        </div>
      ) : null}

      {step === "review" ? (
        <div className="space-y-4">
          <div className="space-y-3 rounded-2xl border border-hairline bg-gradient-to-b from-white to-surface-subtle/80 p-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink">
                Avatar
              </p>
              <p className="mt-0.5 text-xs text-ink-muted">
                these change how your avatar looks.
              </p>
              <dl className="mt-3 space-y-1.5 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-muted">Height</dt>
                  <dd className="font-medium text-ink">{heightLabel}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-muted">Build</dt>
                  <dd className="font-medium text-ink">{buildLabel}</dd>
                </div>
                {attributes.body_shape ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-muted">Body shape</dt>
                    <dd className="text-right font-medium text-ink">
                      {BODY_SHAPE_LABELS[attributes.body_shape]}
                    </dd>
                  </div>
                ) : null}
                {attributes.bust_fullness ? (
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-muted">Bust</dt>
                    <dd className="font-medium text-ink">
                      {BUST_FULLNESS_LABELS[attributes.bust_fullness]}
                    </dd>
                  </div>
                ) : null}
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-muted">Muscle</dt>
                  <dd className="font-medium text-ink">{muscleLabel}</dd>
                </div>
              </dl>
            </div>

            <div className="border-t border-hairline-soft pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink">
                Shopping fit
              </p>
              <p className="mt-0.5 text-xs text-ink-muted">
                these power fit-checked shopping — they don&apos;t change the
                image.
              </p>
              <p className="mt-2 text-sm text-ink">
                {filledMeasurements.length === 0
                  ? "No precise measurements"
                  : `${filledMeasurements.length} measurement${filledMeasurements.length === 1 ? "" : "s"} on file`}
              </p>
            </div>
          </div>

          <button
            type="button"
            className="btn-primary w-full gap-2"
            disabled={busy || !hasRequiredSilhouetteAttributes(attributes)}
            onClick={() => void generate()}
          >
            <Sparkles className="size-4" />
            Create my avatar
          </button>
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
