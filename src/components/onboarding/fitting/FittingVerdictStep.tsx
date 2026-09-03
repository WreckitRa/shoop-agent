"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/ai-chat/cn";
import { FittingCta, FittingKick } from "@/components/onboarding/onboarding-ui";
import { guestFetch } from "@/lib/client/guest-fetch";
import type { StyleMix } from "@/lib/onboarding/style-mix";
import {
  groupReadingLooks,
  productForStep,
  uniqueLookProducts,
  wardrobePlanHasBuys,
  type ReadingLookItem,
  type ReadingLookProduct,
} from "@/lib/photo-analysis/reading-looks";
import { buildReadingView } from "@/lib/photo-analysis/verdict-reading";
import type { ReadingRec } from "@/lib/photo-analysis/verdict-reading";
import { trackClientEvent } from "@/lib/analytics/client";
import type { StylistVerdict } from "@/lib/photo-analysis/verdict";
import { catalogDisplayImageUrl, CATALOG_IMAGE_PX } from "@/lib/shopify/catalog-display-image";
import {
  TRYON_CLIENT_POLL_MAX_MS,
  TRYON_CLIENT_POLL_MS,
} from "@/lib/tryon/client-poll";
import type { BuildKey, SilhouetteForm } from "./types";

type Props = {
  preferredName: string;
  wornLabels: string[];
  stealLabels: string[];
  leanLabel: string;
  form: SilhouetteForm;
  build: BuildKey | null;
  vetoCount: number;
  verdict?: StylistVerdict | null;
  styleMix?: StyleMix | null;
  developPct: number;
  circleNames?: string[];
  /** Twin minted — dress looks on you, not catalog stills. */
  twinReady?: boolean;
  busy?: boolean;
  accountReady?: boolean;
  onSaveLooks?: (jobIds: string[]) => void;
  onAskCircle?: () => void;
  onMeetTwin?: () => void;
  ctaLabel?: string;
  onShare?: (selectedCircle: string[]) => void;
  shareCopied?: boolean;
};

const BUILD_TXT: Record<BuildKey, string> = {
  slim: "your frame carries drape and layering beautifully",
  average:
    "nearly every cut works on you... precise fit is your superpower",
  athletic: "structure and taper show your shape... boxy hides it",
  broad: "strong shoulders love clean lines and hate cling",
  plus: "drape, structure and the right rise do the work... cling never will",
};

const DONUT_R = 72;
const DONUT_C = 2 * Math.PI * DONUT_R;
const DONUT_GAP = 3;
const LOOKS_ON_YOU = 5;

type LookOnYou = "loading" | "error" | string;

async function pollLookJob(jobId: string): Promise<string | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= TRYON_CLIENT_POLL_MAX_MS) {
    const pollRes = await guestFetch(
      `/api/tryon/fitting-room/${jobId}?source=verdict`,
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
    if (!pollRes.ok) return null;
    const look = pollBody.tryon_look;
    if (look?.status === "completed" && look.final_image_url) {
      return look.final_image_url;
    }
    if (look?.compare) {
      const any =
        look.final_image_url ||
        look.variants?.find((v) => v.image_url)?.image_url;
      const settled = (look.variants ?? []).every(
        (v) => v.status === "completed" || v.status === "failed",
      );
      if (any && settled) return any;
      if (look.status === "failed" && !any) return null;
    } else if (look?.status === "failed") {
      return null;
    }
    await new Promise((r) => setTimeout(r, TRYON_CLIENT_POLL_MS));
  }
  return null;
}

async function fetchReadingLooks(): Promise<ReadingLookItem[]> {
  const res = await guestFetch("/api/onboarding/reading-looks");
  if (!res.ok) return [];
  const json = (await res.json()) as { items?: ReadingLookItem[] };
  return Array.isArray(json.items) ? json.items : [];
}

function productsForLookId(
  items: ReadingLookItem[],
  id: string,
): ReadingLookProduct[] {
  return uniqueLookProducts(
    items
      .filter((item) => item.lookId === id && item.product)
      .map((item) => item.product!),
  );
}

function traceVerdict(event: string, payload: Record<string, unknown> = {}) {
  void guestFetch("/api/onboarding/verdict-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, ...payload }),
  }).catch(() => {});
}

function isDressedUrl(value: LookOnYou | undefined): value is string {
  return Boolean(value) && value !== "loading" && value !== "error";
}

async function startDressJob(
  items: Array<{ provenance: Record<string, unknown> }>,
): Promise<{ url: string; jobId: string } | null> {
  if (!items.length) return null;
  const res = await guestFetch("/api/tryon/fitting-room", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-shoop-verdict": "1",
    },
    body: JSON.stringify({ items }),
  });
  const body = (await res.json()) as { error?: string; jobId?: string };
  if (!res.ok || !body.jobId) return null;
  const url = await pollLookJob(body.jobId);
  if (!url) return null;
  return { url, jobId: body.jobId };
}

/** Same garments the reading pull found — catalog product first, image+piece if that fails. */
async function dressLookOnYou(
  products: ReadingLookProduct[],
): Promise<{ url: string; jobId: string } | null> {
  const slice = products.slice(0, 6);
  if (!slice.length) return null;
  const started = Date.now();
  const byProduct = await startDressJob(
    slice.map((product) => ({
      provenance: { kind: "product" as const, productId: product.id },
    })),
  );
  if (byProduct) {
    trackClientEvent("twin_render_completed", {
      source: "reading_look",
      ms: Date.now() - started,
    });
    return byProduct;
  }
  const byImage = await startDressJob(
    slice.map((product) => ({
      provenance: {
        kind: "image" as const,
        imageUrl: product.imageUrl,
        title: product.title,
        garment: product.garment || product.title,
        styleId: product.id,
      },
    })),
  );
  trackClientEvent(byImage ? "twin_render_completed" : "twin_render_failed", {
    source: "reading_look",
    ms: Date.now() - started,
  });
  return byImage;
}

function TasteDonut({
  mix,
}: {
  mix: Array<{ label: string; percent: number; color: string; detail: string }>;
}) {
  const [active, setActive] = useState(0);
  const top = mix[active] ?? mix[0];
  let offset = 0;
  const segs = mix.map((m, i) => {
    const len = (DONUT_C * m.percent) / 100 - DONUT_GAP;
    const el = { ...m, i, len, offset: -offset };
    offset += (DONUT_C * m.percent) / 100;
    return el;
  });

  return (
    <div className="grid items-center gap-6 sm:grid-cols-[200px_1fr]">
      <div className="relative mx-auto size-[200px] sm:mx-0">
        <svg viewBox="0 0 200 200" className="size-full -rotate-90">
          <circle
            cx="100"
            cy="100"
            r={DONUT_R}
            fill="none"
            stroke="#EDEDEE"
            strokeWidth="34"
          />
          {segs.map((s) => (
            <circle
              key={s.label}
              cx="100"
              cy="100"
              r={DONUT_R}
              fill="none"
              stroke={s.color}
              strokeWidth={active === s.i ? 40 : 34}
              strokeDasharray={`${Math.max(0, s.len)} ${DONUT_C}`}
              strokeDashoffset={s.offset}
              opacity={active === s.i ? 1 : 0.55}
              className="cursor-pointer transition-[stroke-width,opacity] duration-200"
              onMouseEnter={() => setActive(s.i)}
              onFocus={() => setActive(s.i)}
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <div
              className="font-display text-[36px] font-black leading-none tracking-[-0.05em]"
              style={{ color: top?.color }}
            >
              {top ? `${top.percent}%` : "—"}
            </div>
            <div className="mt-1.5 max-w-[120px] text-[11px] font-semibold leading-[1.35] text-[var(--fitting-quiet)]">
              {top?.label.toLowerCase() ?? "your mix"}
            </div>
          </div>
        </div>
      </div>
      <div className="flex w-full flex-col">
        {mix.map((m, i) => (
          <button
            key={m.label}
            type="button"
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            className={cn(
              "flex items-center gap-3 border-b border-[var(--fitting-line)] py-3.5 text-left transition last:border-0",
              active === i ? "opacity-100" : "opacity-55",
            )}
          >
            <span
              className="size-3 shrink-0 rounded-[4px]"
              style={{ background: m.color }}
            />
            <span className="min-w-0 flex-1 font-display text-[15px] font-extrabold">
              {m.label}
              <em className="mt-1 block text-xs font-medium not-italic text-[var(--fitting-quiet)]">
                {m.detail}
              </em>
            </span>
            <span
              className="font-display text-[22px] font-black tracking-[-0.03em]"
              style={{ color: m.color }}
            >
              {m.percent}%
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ColorSwatch({
  hex,
  photo,
  struck,
  caption,
  canRetry,
  onRetry,
  onImageFail,
}: {
  hex: string;
  photo?: LookOnYou;
  struck?: boolean;
  caption?: string;
  canRetry?: boolean;
  onRetry?: () => void;
  onImageFail?: () => void;
}) {
  const dressed = isDressedUrl(photo);
  const loading = !dressed;
  return (
    <div className="min-w-0">
      <div
        className={cn(
          "relative aspect-[4/5] overflow-hidden rounded-xl bg-[#F4F4F6]",
          struck && "saturate-[0.85]",
        )}
      >
        {dressed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt=""
            onError={onImageFail}
            className="absolute inset-0 size-full object-cover object-top"
          />
        ) : (
          <div
            className={cn("absolute inset-0", loading && "animate-pulse")}
            style={{
              background: `radial-gradient(80% 60% at 50% 18%, #FDFDFE 0%, ${hex}55 50%, ${hex} 100%)`,
            }}
          />
        )}
        {struck ? (
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "linear-gradient(135deg, transparent calc(50% - 1px), rgba(220,38,38,0.55) 50%, transparent calc(50% + 1px))",
            }}
          />
        ) : null}
        {!dressed ? (
          <div
            className={cn(
              "absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/50 to-transparent px-1.5 pt-8",
              canRetry ? "pb-9" : "pb-2",
            )}
          >
            <p className="text-center text-[10px] font-bold leading-[1.3] text-white">
              {photo === "error"
                ? "Couldn’t dress this on you."
                : "Dressing this colour on you…"}
            </p>
          </div>
        ) : null}
        {canRetry && onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="absolute inset-x-2 bottom-2 rounded-full bg-white/92 px-2 py-1 text-[10px] font-extrabold tracking-[0.04em] text-[var(--fitting-ink)] shadow-sm"
          >
            Retry
          </button>
        ) : null}
      </div>
      {caption ? (
        <p
          className={cn(
            "mt-1.5 text-[11px] font-semibold leading-[1.3]",
            struck ? "text-[#DC2626]" : "text-[var(--fitting-ink)]",
          )}
        >
          {caption}
        </p>
      ) : null}
    </div>
  );
}

function LooksOnYouRail({
  fiveLooks,
  lookOnYou,
  pulling,
  twinReady,
  onRetry,
  onImageFail,
}: {
  fiveLooks: Array<{
    id: string;
    label: string;
    formula: string;
    products: ReadingLookProduct[];
  }>;
  lookOnYou: Record<string, LookOnYou>;
  pulling: boolean;
  twinReady: boolean;
  onRetry: (id: string) => void;
  onImageFail: (id: string) => void;
}) {
  const slots =
    pulling && !fiveLooks.length
      ? Array.from({ length: LOOKS_ON_YOU }, (_, i) => ({
          id: `pending-${i}`,
          label: `Look ${i + 1}`,
          formula: "",
          products: [] as ReadingLookProduct[],
        }))
      : fiveLooks;

  const stillWorking =
    pulling ||
    slots.some((group) => {
      const onYou = lookOnYou[group.id];
      return (
        onYou === "loading" ||
        (!twinReady && group.products.length > 0 && !isDressedUrl(onYou))
      );
    });

  return (
    <div>
      <FittingKick>FIVE LOOKS ON YOU</FittingKick>
      <p className="mt-1.5 text-[12.5px] leading-[1.45] text-[var(--fitting-quiet)]">
        {stillWorking
          ? twinReady
            ? "Dressing each look on you — this can take a minute."
            : "Waiting for your twin, then dressing each look on you."
          : null}
      </p>
      <div className="mt-3 -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2 [scrollbar-width:thin]">
        {slots.map((group) => {
          const onYou = lookOnYou[group.id];
          const dressed = isDressedUrl(onYou);
          const canRetry = !dressed && onYou !== "loading" && !pulling;
          const status = !twinReady
            ? "Waiting for your twin…"
            : onYou === "error"
              ? "Couldn’t dress this on you."
              : pulling || !group.products.length
                ? "Finding this look…"
                : "Dressing this on you…";
          return (
            <div
              key={group.id}
              className="w-[min(220px,70vw)] shrink-0 snap-start"
            >
              <div className="mb-1.5 font-display text-[12.5px] font-extrabold leading-[1.2] tracking-[-0.02em]">
                {group.label}
              </div>
              {dressed ? (
                <div className="overflow-hidden rounded-2xl bg-[#F4F4F6]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={onYou}
                    alt=""
                    onError={() => onImageFail(group.id)}
                    className="aspect-[3/4] w-full object-cover object-top"
                  />
                </div>
              ) : (
                <div className="relative overflow-hidden rounded-2xl border border-[var(--fitting-line)] bg-[#F7F7F8]">
                  <div className="aspect-[3/4] w-full animate-pulse bg-[#E8E8EC]" />
                  <div className="absolute inset-0 flex flex-col items-center justify-end bg-gradient-to-t from-black/45 via-black/10 to-transparent px-3 pb-3 pt-10">
                    <p className="text-center text-[12px] font-semibold leading-[1.35] text-white">
                      {status}
                    </p>
                    {canRetry ? (
                      <button
                        type="button"
                        onClick={() => onRetry(group.id)}
                        className="mt-2 rounded-full border border-white/70 bg-white px-2.5 py-1 text-[10.5px] font-extrabold tracking-[0.04em] text-[var(--fitting-ink)]"
                      >
                        Retry
                      </button>
                    ) : null}
                  </div>
                </div>
              )}
              {group.formula ? (
                <p className="mt-1.5 text-[11px] leading-[1.4] text-[var(--fitting-quiet)]">
                  {group.formula}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function recIcon(kind: ReadingRec["kind"]) {
  if (kind === "do") return { mark: "✓", cls: "bg-[rgba(22,163,74,0.14)] text-[var(--fitting-good)]" };
  if (kind === "dont") return { mark: "✕", cls: "bg-[rgba(220,38,38,0.12)] text-[#DC2626]" };
  return { mark: "○", cls: "bg-[#EEE] text-[var(--fitting-quiet)]" };
}

export function FittingVerdictStep({
  preferredName,
  wornLabels,
  stealLabels,
  leanLabel,
  form,
  build,
  vetoCount,
  verdict = null,
  styleMix = null,
  developPct: _developPct,
  circleNames: _circleNames = [],
  twinReady = false,
  busy,
  accountReady = false,
  onSaveLooks,
  onAskCircle,
  onMeetTwin,
  ctaLabel: _ctaLabel,
  onShare: _onShare,
  shareCopied: _shareCopied,
}: Props) {
  const [openArea, setOpenArea] = useState<string | null>(null);
  const [fullReadingOpen, setFullReadingOpen] = useState(false);
  const [looks, setLooks] = useState<ReadingLookItem[] | null>(null);
  const looksInflight = useRef<Promise<ReadingLookItem[]> | null>(null);

  const first =
    preferredName.trim().charAt(0).toUpperCase() +
    preferredName.trim().slice(1).toLowerCase();

  const buildTxt = build
    ? BUILD_TXT[build]
    : "we'll fine-tune the cut as we shop together";
  const formTip =
    form === "f"
      ? "Waist definition is your friend... let pieces follow it."
      : form === "m"
        ? "Let the shoulder line lead... everything hangs from there."
        : "Balance over rules... we fit the body you have, not a template.";

  const reading = useMemo(
    () =>
      buildReadingView({
        verdict,
        styleMix,
        wornLabels,
        stealLabels,
        leanLabel,
        buildFallbackCopy: `${buildTxt.charAt(0).toUpperCase() + buildTxt.slice(1)}. ${formTip}`,
      }),
    [verdict, styleMix, wornLabels, stealLabels, leanLabel, buildTxt, formTip],
  );

  useEffect(() => {
    if (!reading.areas.length) {
      setOpenArea(null);
      return;
    }
    const fix = reading.areas.find((a) => a.verdict === "n");
    setOpenArea(fix?.id ?? reading.areas[0]!.id);
  }, [reading.areas]);

  useEffect(() => {
    if (!verdict) return;
    if (!looksInflight.current) {
      looksInflight.current = fetchReadingLooks();
    }
    const req = looksInflight.current;
    let live = true;
    traceVerdict("looks-fetch");
    void req
      .catch(() => [] as ReadingLookItem[])
      .then((items) => {
        if (!live) return;
        traceVerdict("looks-fetch-ok", {
          n: items.length,
          withProduct: items.filter((item) => item.product).length,
        });
        setLooks(items);
        setLookOnYou((prev) => {
          const next = { ...prev };
          for (const item of items) {
            if (item.kind !== "swatch" && item.kind !== "avoid") continue;
            if (!item.lookId || item.product) continue;
            if (next[item.lookId] === "loading" || isDressedUrl(next[item.lookId])) {
              continue;
            }
            next[item.lookId] = "error";
          }
          return next;
        });
      });
    return () => {
      live = false;
    };
  }, [verdict]);

  function toggleArea(id: string) {
    setOpenArea((prev) => (prev === id ? null : id));
  }

  const groupedLooks = useMemo(
    () => groupReadingLooks(looks ?? []),
    [looks],
  );
  const fiveLooks = useMemo(
    () => groupedLooks.looks.slice(0, LOOKS_ON_YOU),
    [groupedLooks],
  );
  const dressJobs = useMemo(() => {
    const outfits = fiveLooks.filter((group) => group.products.length);
    const faces = (looks ?? [])
      .filter(
        (item) =>
          (item.kind === "swatch" || item.kind === "avoid") &&
          item.product &&
          item.lookId,
      )
      .map((item) => ({
        id: item.lookId!,
        label: item.lookLabel || "",
        products: [item.product!],
      }));
    return [...outfits, ...faces];
  }, [fiveLooks, looks]);
  const [lookOnYou, setLookOnYou] = useState<Record<string, LookOnYou>>({});
  const dressedLooksRef = useRef(new Set<string>());
  const lookJobIdsRef = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!twinReady) {
      if (dressJobs.length) {
        traceVerdict("dress-wait", { jobs: dressJobs.length });
      }
      return;
    }
    const pending = dressJobs.filter(
      (group) => group.products.length && !dressedLooksRef.current.has(group.id),
    );
    if (!pending.length) {
      if (dressJobs.length) {
        traceVerdict("dress-skip", {
          jobs: dressJobs.length,
          already: dressedLooksRef.current.size,
        });
      }
      return;
    }
    let cancelled = false;
    const started = pending.map((group) => group.id);
    traceVerdict("dress-pending", { ids: started });
    void (async () => {
      await Promise.all(
        pending.map(async (group) => {
          dressedLooksRef.current.add(group.id);
          setLookOnYou((prev) => ({ ...prev, [group.id]: "loading" }));
          try {
            const dressed = await dressLookOnYou(group.products);
            if (cancelled) {
              traceVerdict("dress-cancelled", { id: group.id });
              return;
            }
            if (dressed && group.id.startsWith("look-")) {
              lookJobIdsRef.current[group.id] = dressed.jobId;
            }
            traceVerdict("dress-done", {
              id: group.id,
              ok: Boolean(dressed),
              jobId: dressed?.jobId,
            });
            setLookOnYou((prev) => ({
              ...prev,
              [group.id]: dressed?.url ?? "error",
            }));
          } catch (err) {
            if (cancelled) {
              traceVerdict("dress-cancelled", { id: group.id });
              return;
            }
            traceVerdict("dress-fail", {
              id: group.id,
              error: err instanceof Error ? err.message : "unknown",
            });
            setLookOnYou((prev) => ({ ...prev, [group.id]: "error" }));
          }
        }),
      );
    })();
    return () => {
      cancelled = true;
      for (const id of started) dressedLooksRef.current.delete(id);
    };
  }, [dressJobs, twinReady]);

  function failImage(id: string) {
    setLookOnYou((prev) => {
      if (!isDressedUrl(prev[id])) return prev;
      return { ...prev, [id]: "error" };
    });
  }

  function retryDress(id: string) {
    if (lookOnYou[id] === "loading") return;
    setLookOnYou((prev) => ({ ...prev, [id]: "loading" }));
    void (async () => {
      try {
        let products =
          dressJobs.find((group) => group.id === id)?.products ?? [];
        if (!products.length) {
          looksInflight.current = null;
          const items = await fetchReadingLooks();
          looksInflight.current = Promise.resolve(items);
          setLooks(items);
          products = productsForLookId(items, id);
        }
        if (!products.length) {
          setLookOnYou((prev) => ({ ...prev, [id]: "error" }));
          return;
        }
        dressedLooksRef.current.add(id);
        const dressed = await dressLookOnYou(products);
        if (dressed && id.startsWith("look-")) {
          lookJobIdsRef.current[id] = dressed.jobId;
        }
        setLookOnYou((prev) => ({ ...prev, [id]: dressed?.url ?? "error" }));
      } catch {
        setLookOnYou((prev) => ({ ...prev, [id]: "error" }));
      }
    })();
  }

  const askCircle = onAskCircle ?? onMeetTwin;

  return (
    <section className="max-w-[920px] pb-4">
      <FittingKick>DONE</FittingKick>
      <h1 className="font-display text-[clamp(26px,7.6vw,33px)] font-black leading-[1] tracking-[-0.042em] text-[var(--fitting-ink)] lg:text-[clamp(26px,3.6vw,40px)] lg:leading-[0.97] lg:tracking-[-0.045em]">
        {first ? `${first}, here's` : "Here's"}
        <br />
        what I <span className="text-[var(--fitting-red)]">see.</span>
      </h1>
      <p className="mt-3 font-[family-name:var(--font-fraunces)] text-[14px] italic leading-[1.45] text-[var(--fitting-quiet)] lg:mt-3 lg:font-sans lg:text-[14.5px] lg:not-italic lg:leading-[1.62] [&_b]:font-semibold [&_b]:text-[var(--fitting-ink)]">
        {reading.headline ? (
          <>
            <b>{reading.headline}.</b>{" "}
          </>
        ) : null}
        {reading.opening}
      </p>

      <div className="mt-6">
        <LooksOnYouRail
          fiveLooks={fiveLooks}
          lookOnYou={lookOnYou}
          pulling={Boolean(verdict) && looks === null}
          twinReady={twinReady}
          onRetry={retryDress}
          onImageFail={failImage}
        />
      </div>

      {reading.palette.length ? (
        <div className="mt-8 border-t border-[var(--fitting-line)] pt-7">
          <FittingKick>YOUR COLORS, FROM YOUR FACE</FittingKick>
          {looks === null ||
          reading.palette.some(
            (_, i) =>
              lookOnYou[`swatch-${i}`] === "loading" ||
              (lookOnYou[`swatch-${i}`] !== "error" &&
                !isDressedUrl(lookOnYou[`swatch-${i}`])),
          ) ? (
            <p className="mt-1.5 text-[12.5px] leading-[1.45] text-[var(--fitting-quiet)]">
              Dressing each colour on you — not a product photo.
            </p>
          ) : null}
          <div className="mt-3 grid grid-cols-3 gap-2.5 sm:grid-cols-6">
            {reading.palette.map((s, i) => (
              <ColorSwatch
                key={s.name}
                hex={s.hex}
                photo={lookOnYou[`swatch-${i}`]}
                caption={s.name}
                canRetry={
                  looks !== null &&
                  lookOnYou[`swatch-${i}`] !== "loading" &&
                  !isDressedUrl(lookOnYou[`swatch-${i}`]) &&
                  (lookOnYou[`swatch-${i}`] === "error" ||
                    !looks.some(
                      (item) => item.lookId === `swatch-${i}` && item.product,
                    ))
                }
                onRetry={() => retryDress(`swatch-${i}`)}
                onImageFail={() => failImage(`swatch-${i}`)}
              />
            ))}
          </div>
          {reading.avoid.length ? (
            <div className="mt-5">
              <div className="mb-3 font-display text-[9.5px] font-extrabold tracking-[0.15em] text-[#DC2626]">
                NEVER NEXT TO YOUR FACE
              </div>
              <div className="grid max-w-[280px] grid-cols-2 gap-2.5">
                {reading.avoid.map((s, i) => (
                  <ColorSwatch
                    key={s.name}
                    hex={s.hex}
                    photo={lookOnYou[`avoid-${i}`]}
                    struck
                    caption={s.use ? `${s.name} — ${s.use}` : s.name}
                    canRetry={
                      looks !== null &&
                      lookOnYou[`avoid-${i}`] !== "loading" &&
                      !isDressedUrl(lookOnYou[`avoid-${i}`]) &&
                      (lookOnYou[`avoid-${i}`] === "error" ||
                        !looks.some(
                          (item) => item.lookId === `avoid-${i}` && item.product,
                        ))
                    }
                    onRetry={() => retryDress(`avoid-${i}`)}
                    onImageFail={() => failImage(`avoid-${i}`)}
                  />
                ))}
              </div>
            </div>
          ) : null}
          {reading.paletteLine ? (
            <p className="mt-3.5 text-[13px] leading-[1.65] text-[var(--fitting-quiet)]">
              {reading.paletteLine}
            </p>
          ) : null}
        </div>
      ) : null}

      {reading.rules.length ? (
        <div className="mt-8 border-t border-[var(--fitting-line)] pt-7">
          <FittingKick>THREE RULES I&apos;LL HOLD YOU TO</FittingKick>
          <ul className="mt-3 list-none">
            {reading.rules.map((r) => (
              <li
                key={`${r.ok}-${r.text}`}
                className="flex gap-2.5 border-t border-[var(--fitting-line)] py-3 text-[13.5px] leading-[1.45] first:border-0"
              >
                <i
                  className={cn(
                    "mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full text-[10px] font-extrabold not-italic",
                    r.ok
                      ? "bg-[rgba(22,163,74,0.14)] text-[var(--fitting-good)]"
                      : "bg-[rgba(220,38,38,0.12)] text-[#DC2626]",
                  )}
                >
                  {r.ok ? "✓" : "✕"}
                </i>
                <span className="font-display text-[15px] font-extrabold">
                  {r.text}
                </span>
              </li>
            ))}
          </ul>
          {vetoCount > 0 ? (
            <p className="mt-3 text-[13px] text-[var(--fitting-quiet)]">
              Your <b className="text-[var(--fitting-ink)]">{vetoCount} vetoes</b> stay locked.
            </p>
          ) : null}
        </div>
      ) : vetoCount > 0 ? (
        <p className="mt-6 text-[13px] text-[var(--fitting-quiet)]">
          Your <b className="text-[var(--fitting-ink)]">{vetoCount} vetoes</b> stay locked.
        </p>
      ) : null}

      <footer className="mt-8 overflow-hidden rounded-[20px] bg-[var(--fitting-ink)] px-6 py-7 text-white">
        <FittingKick>
          <span className="text-[#FF8A90]">KEEP THESE LOOKS</span>
        </FittingKick>
        <h3 className="font-display text-[25px] font-black tracking-[-0.035em]">
          {accountReady
            ? "Save these looks to your moodboard"
            : "Save progress and log in"}
        </h3>
        <p className="mt-2 text-[13.5px] leading-[1.6] text-[#B4B4C0]">
          {accountReady
            ? "I’ll keep every look on your moodboard — in your size, with what we need to check out. Then we’ll ask your circle before we close the Fitting."
            : "Log in so I can save these looks to your moodboard — in your size, ready to buy. After that we ask your circle, then we close the Fitting."}
        </p>
        <div className="mt-[18px] flex flex-wrap items-center gap-2.5">
          <FittingCta
            onClick={() => {
              const jobIds = Object.values(lookJobIdsRef.current);
              if (onSaveLooks) {
                onSaveLooks(jobIds);
                return;
              }
              askCircle?.();
            }}
            disabled={busy}
            inverse
          >
            {busy
              ? "Saving…"
              : accountReady
                ? "Save looks and continue"
                : "Save progress and log in"}
          </FittingCta>
          {askCircle ? (
            <button
              type="button"
              onClick={askCircle}
              className="text-[12.5px] font-semibold text-[#B4B4C0] underline-offset-2 hover:text-white hover:underline"
            >
              Skip to your circle
            </button>
          ) : null}
        </div>
      </footer>

      {reading.areas.length ||
      reading.steps.length >= 2 ||
      reading.mix.length ||
      reading.from.length ||
      groupedLooks.buys.length ? (
        <div className="mt-8 border-t border-[var(--fitting-line)] pt-5">
          <button
            type="button"
            onClick={() => setFullReadingOpen((v) => !v)}
            className="w-full rounded-2xl border-2 border-dashed border-[#C8C8CC] bg-[#FAFAFB] px-4 py-4 text-left transition hover:border-[var(--fitting-ink)] hover:bg-white"
            aria-expanded={fullReadingOpen}
          >
            <span className="flex items-center gap-3">
              <span className="min-w-0 flex-1">
                <span className="block font-display text-[17px] font-extrabold tracking-[-0.02em]">
                  {fullReadingOpen ? "Hide the full reading" : "The full reading"}
                </span>
                <span className="mt-0.5 block text-[13px] font-semibold leading-[1.4] text-[var(--fitting-red)]">
                  {fullReadingOpen
                    ? "Colour, fit, and the taste you picked"
                    : "Tap to expand — colour, fit, and the taste you picked"}
                </span>
              </span>
              <span
                className={cn(
                  "grid size-10 shrink-0 place-items-center rounded-full border border-[var(--fitting-line)] bg-white text-[18px] leading-none text-[var(--fitting-ink)] transition-transform",
                  fullReadingOpen && "rotate-180",
                )}
                aria-hidden
              >
                ▾
              </span>
            </span>
            {!fullReadingOpen ? (
              <span className="relative mt-3 block max-h-[4.6em] overflow-hidden rounded-xl bg-white/80 px-3 py-2.5 text-[13px] leading-[1.5] text-[var(--fitting-quiet)]">
                {reading.paletteLine ||
                  reading.opening ||
                  "More on colour, fit, and the mix you picked."}
                <span className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[#FAFAFB] to-transparent" />
              </span>
            ) : null}
          </button>
          {fullReadingOpen ? (
            <div className="pt-4">
              {reading.from.length ? (
                <p className="mb-6 text-[11px] leading-[1.55] text-[#A8A8B0]">
                  from: {reading.from.join(" · ")}
                </p>
              ) : null}
              {reading.steps.length >= 2 ? (
                <div className="mb-8">
                  <FittingKick>THE DIFFERENCE</FittingKick>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    {reading.steps.map((s) => {
                      const piece = wardrobePlanHasBuys(verdict)
                        ? productForStep(s.why, looks ?? [])
                        : null;
                      return (
                        <div
                          key={s.step}
                          className="rounded-2xl border border-[var(--fitting-line)] bg-[#FAFAFB] p-3.5"
                        >
                          <div className="mb-2 font-display text-[9px] font-extrabold tracking-[0.16em] text-[var(--fitting-red)]">
                            {s.label}
                          </div>
                          {piece ? (
                            <div className="mb-3 overflow-hidden rounded-xl bg-white">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={catalogDisplayImageUrl(
                                  piece.imageUrl,
                                  CATALOG_IMAGE_PX.stack,
                                )}
                                alt={piece.title}
                                className="aspect-[3/4] w-full object-cover"
                              />
                            </div>
                          ) : null}
                          <div className="font-display text-[14.5px] font-extrabold leading-[1.25] tracking-[-0.02em]">
                            {s.name}
                          </div>
                          {s.why !== s.name ? (
                            <p className="mt-2 text-[12px] leading-[1.55] text-[var(--fitting-quiet)]">
                              {s.why}
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {groupedLooks.buys.length ? (
                <div className="mb-8">
                  <FittingKick>FIRST TO GET</FittingKick>
                  <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                    {groupedLooks.buys.slice(0, 6).map((piece) => (
                      <figure
                        key={piece.id}
                        className="overflow-hidden rounded-2xl border border-[var(--fitting-line)] bg-[#FAFAFB]"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={catalogDisplayImageUrl(
                            piece.imageUrl,
                            CATALOG_IMAGE_PX.stack,
                          )}
                          alt={piece.title}
                          className="aspect-[3/4] w-full object-cover"
                        />
                        <figcaption className="p-2.5 font-display text-[12px] font-extrabold leading-[1.3] tracking-[-0.02em]">
                          {piece.title}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                </div>
              ) : null}

              {reading.areas.length ? (
                <div className="mb-8">
                  <FittingKick>WHAT YOU CAN AND CANNOT</FittingKick>
                  <div className="mt-3 flex flex-col gap-2">
                    {reading.areas.map((a) => {
                      const open = openArea === a.id;
                      const dos = a.recs.filter((r) => r.kind === "do");
                      const donts = a.recs.filter((r) => r.kind === "dont");
                      const checks = a.recs.filter((r) => r.kind === "check");
                      return (
                        <div
                          key={a.id}
                          className={cn(
                            "overflow-hidden rounded-2xl border border-[var(--fitting-line)] transition",
                            open &&
                              "border-[#D6D6D9] shadow-[0_16px_34px_-22px_rgba(14,14,17,0.35)]",
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => toggleArea(a.id)}
                            className="flex w-full items-center gap-3.5 p-3.5 text-left hover:bg-[#F7F7F8]"
                          >
                            <span className="min-w-0 flex-1">
                              <b className="block font-display text-[15px] font-extrabold">
                                {a.name}
                              </b>
                              <em className="mt-0.5 block text-xs not-italic text-[var(--fitting-quiet)]">
                                {a.sum}
                              </em>
                            </span>
                            <span
                              className={cn(
                                "shrink-0 rounded-full px-2.5 py-1 font-display text-[10px] font-black tracking-[0.08em]",
                                a.verdict === "y" &&
                                  "bg-[rgba(22,163,74,0.12)] text-[var(--fitting-good)]",
                                a.verdict === "n" &&
                                  "bg-[rgba(220,38,38,0.1)] text-[#DC2626]",
                                a.verdict === "c" &&
                                  "bg-[#F0EFE8] text-[#6B5E3C]",
                              )}
                            >
                              {a.vlab}
                            </span>
                            <span
                              className={cn(
                                "text-[13px] text-[#C2C2C6] transition-transform",
                                open && "rotate-180",
                              )}
                            >
                              ▾
                            </span>
                          </button>
                          {open ? (
                            <div className="px-3.5 pb-4 pt-0">
                              <div className="mb-3.5 rounded-xl border border-[var(--fitting-line)] bg-[#F7F7F8] px-3.5">
                                {a.metrics.map((m) => (
                                  <div
                                    key={m.label}
                                    className="flex items-start justify-between gap-3 border-b border-[var(--fitting-line)] py-2.5 text-[12.5px] last:border-0"
                                  >
                                    <span className="shrink-0 font-semibold text-[var(--fitting-quiet)]">
                                      {m.label}
                                    </span>
                                    <span
                                      className={cn(
                                        "min-w-0 text-right font-display text-[13px] font-black break-words",
                                        m.tone === "hi" &&
                                          "text-[var(--fitting-good)]",
                                        m.tone === "lo" && "text-[#DC2626]",
                                      )}
                                    >
                                      {m.value}
                                    </span>
                                  </div>
                                ))}
                              </div>
                              {a.insight ? (
                                <div className="mb-3">
                                  <div className="mb-2 font-display text-[10px] font-extrabold tracking-[0.13em] text-[var(--fitting-red)]">
                                    WHAT THIS MEANS
                                  </div>
                                  <p className="text-[13px] leading-[1.65] text-[var(--fitting-quiet)]">
                                    {a.insight}
                                  </p>
                                </div>
                              ) : null}
                              {[dos, donts].some((list) => list.length) ? (
                                <ul className="list-none">
                                  {[...dos, ...donts].map((r) => {
                                    const icon = recIcon(r.kind);
                                    return (
                                      <li
                                        key={`${r.kind}-${r.title}`}
                                        className="flex gap-2.5 border-t border-[var(--fitting-line)] py-2.5 text-[12.5px] leading-[1.5]"
                                      >
                                        <i
                                          className={cn(
                                            "mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full text-[10px] font-extrabold not-italic",
                                            icon.cls,
                                          )}
                                        >
                                          {icon.mark}
                                        </i>
                                        <span>
                                          <b className="mb-0.5 block font-display text-[13px] font-extrabold">
                                            {r.title}
                                          </b>
                                        </span>
                                      </li>
                                    );
                                  })}
                                </ul>
                              ) : null}
                              {checks.length ? (
                                <div className="mt-3">
                                  <div className="mb-2 font-display text-[10px] font-extrabold tracking-[0.13em] text-[var(--fitting-quiet)]">
                                    CHECK ON THE PIECE:
                                  </div>
                                  <ul className="list-none">
                                    {checks.map((r) => {
                                      const icon = recIcon("check");
                                      return (
                                        <li
                                          key={`check-${r.title}`}
                                          className="flex gap-2.5 border-t border-[var(--fitting-line)] py-2.5 text-[12.5px] leading-[1.5]"
                                        >
                                          <i
                                            className={cn(
                                              "mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full text-[10px] font-extrabold not-italic",
                                              icon.cls,
                                            )}
                                          >
                                            {icon.mark}
                                          </i>
                                          <span className="font-display text-[13px] font-extrabold">
                                            {r.title}
                                          </span>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {reading.mix.length ? (
                <div>
                  <FittingKick>THE TASTE YOU PICKED</FittingKick>
                  <div className="mt-3">
                    <TasteDonut mix={reading.mix} />
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
