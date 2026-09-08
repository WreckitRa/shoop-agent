"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/ai-chat/cn";
import { FittingCta, FittingKick } from "@/components/onboarding/onboarding-ui";
import { guestFetch } from "@/lib/client/guest-fetch";
import type { StyleMix } from "@/lib/onboarding/style-mix";
import type {
  LookCardPublic,
  ReadingLooksPayload,
} from "@/lib/looks/public-types";
import { FITTING_LOOK_COUNT } from "@/lib/photo-analysis/style-contract";
import { buildReadingView } from "@/lib/photo-analysis/verdict-reading";
import type { StylistVerdict } from "@/lib/photo-analysis/verdict";
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
  /** Twin minted — dress looks on you, not catalog stills. */
  twinReady?: boolean;
  busy?: boolean;
  accountReady?: boolean;
  onSaveLooks?: (jobIds: string[]) => void;
  onFinish?: () => void;
  ctaLabel?: string;
};

const BUILD_TXT: Record<BuildKey, string> = {
  slim: "your frame carries drape and layering beautifully",
  average:
    "nearly every cut works on you... precise fit is your superpower",
  athletic: "structure and taper show your shape... boxy hides it",
  broad: "strong shoulders love clean lines and hate cling",
  plus: "drape, structure and the right rise do the work... cling never will",
};

function traceVerdict(event: string, payload: Record<string, unknown> = {}) {
  void guestFetch("/api/onboarding/verdict-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, ...payload }),
  }).catch(() => {});
}

async function fetchReadingLooks(): Promise<ReadingLooksPayload> {
  const res = await guestFetch("/api/onboarding/reading-looks");
  if (!res.ok) return { looks: [], swatches: [], pending: false };
  const json = (await res.json()) as Partial<ReadingLooksPayload>;
  return {
    looks: Array.isArray(json.looks) ? json.looks : [],
    swatches: Array.isArray(json.swatches) ? json.swatches : [],
    pending: Boolean(json.pending),
  };
}

function ColorSwatch({
  hex,
  photo,
  products,
  struck,
  caption,
  loading,
}: {
  hex: string;
  photo?: string | null;
  products?: Array<{ id: string; imageUrl: string }> | null;
  struck?: boolean;
  caption?: string;
  loading?: boolean;
}) {
  const thumbs = (products ?? []).filter((p) => p.imageUrl).slice(0, 4);
  return (
    <div className="min-w-0">
      <div
        className={cn(
          "relative aspect-[4/5] overflow-hidden rounded-xl bg-[#F4F4F6]",
          struck && "saturate-[0.85]",
        )}
      >
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt=""
            className="absolute inset-0 size-full object-cover object-top"
          />
        ) : thumbs[0] ? (
          <div className="absolute inset-0 grid grid-cols-2 gap-0.5 bg-[#E8E8EC]">
            {thumbs.map((p) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={p.id}
                src={p.imageUrl}
                alt=""
                className="size-full object-cover"
              />
            ))}
          </div>
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
        {loading ? (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/50 to-transparent px-1.5 pb-2 pt-8">
            <p className="text-center text-[10px] font-bold leading-[1.3] text-white">
              Dressing this colour on you…
            </p>
          </div>
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
  looks,
  pending,
  thisWeek,
  onRetry,
}: {
  looks: LookCardPublic[];
  pending: boolean;
  thisWeek?: string;
  onRetry: (lookIndex: number) => void;
}) {
  const stillWorking = pending || looks.some((l) => l.status === "queued" || l.status === "products_ready" || l.status === "rendering");
  const visible = looks.slice(0, FITTING_LOOK_COUNT);

  return (
    <div>
      <FittingKick>FIVE LOOKS ON YOU</FittingKick>
      <p className="mt-1.5 text-[12.5px] leading-[1.45] text-[var(--fitting-quiet)]">
        Colour and style preview on your twin — not a size check.
        {stillWorking ? " Dressing each look — this can take a minute." : ""}
      </p>
      <div className="mt-3 -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2 [scrollbar-width:thin]">
        {visible.map((look) => {
          const thumbs = look.pieces.map((p) => p.product).filter(Boolean);
          const formula = look.pieces
            .map((p) => p.spec.shade ? `${p.spec.shade} ${p.spec.garment_type}` : p.spec.garment_type)
            .join(" · ");
          const canRetry =
            look.status === "degraded" ||
            look.status === "failed" ||
            (!look.renderUrl &&
              look.status !== "queued" &&
              look.status !== "products_ready" &&
              look.status !== "rendering");
          const status =
            look.status === "ready" || look.status === "degraded"
              ? null
              : look.status === "failed"
                ? "Couldn't dress this look"
                : look.status === "products_ready"
                  ? "Found the garments…"
                  : look.status === "rendering"
                    ? "Dressing this on you…"
                    : "Finding this look…";
          return (
            <div
              key={look.id || String(look.lookIndex)}
              className="relative z-[1] w-[min(220px,70vw)] shrink-0 snap-start"
            >
              <div className="mb-1.5 font-display text-[12.5px] font-extrabold leading-[1.2] tracking-[-0.02em]">
                {look.name}
              </div>
              {look.renderUrl ? (
                <div className="overflow-hidden rounded-2xl bg-[#F4F4F6]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={look.renderUrl}
                    alt=""
                    className="aspect-[3/4] w-full object-cover object-top"
                  />
                </div>
              ) : (
                <div className="relative overflow-hidden rounded-2xl border border-[var(--fitting-line)] bg-[#F7F7F8]">
                  {thumbs[0] ? (
                    <div className="grid aspect-[3/4] grid-cols-2 gap-0.5 bg-[#E8E8EC]">
                      {thumbs.slice(0, 4).map((p) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={p!.id}
                          src={p!.imageUrl}
                          alt=""
                          className="size-full object-cover"
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="aspect-[3/4] w-full animate-pulse bg-[#E8E8EC]" />
                  )}
                  {status ? (
                    canRetry ? (
                      <button
                        type="button"
                        onClick={() => onRetry(look.lookIndex)}
                        className="absolute inset-0 z-[2] flex touch-manipulation flex-col items-center justify-end bg-gradient-to-t from-black/55 via-black/15 to-transparent px-3 pb-4 pt-10"
                      >
                        <p className="text-center text-[12px] font-semibold leading-[1.35] text-white">
                          {status}
                        </p>
                        <span className="mt-2 rounded-full bg-white px-4 py-2 text-[12px] font-extrabold tracking-[0.02em] text-[var(--fitting-ink)]">
                          Retry
                        </span>
                      </button>
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-end bg-gradient-to-t from-black/45 via-black/10 to-transparent px-3 pb-3 pt-10">
                        <p className="text-center text-[12px] font-semibold leading-[1.35] text-white">
                          {status}
                        </p>
                      </div>
                    )
                  ) : null}
                </div>
              )}
              {look.renderNote ? (
                <p className="mt-1.5 text-[11px] leading-[1.4] text-[var(--fitting-quiet)]">
                  {look.renderNote}
                </p>
              ) : formula ? (
                <p className="mt-1.5 text-[11px] leading-[1.4] text-[var(--fitting-quiet)]">
                  {formula}
                </p>
              ) : null}
              {canRetry && look.renderUrl ? (
                <button
                  type="button"
                  onClick={() => onRetry(look.lookIndex)}
                  className="relative z-[2] mt-1 min-h-11 touch-manipulation px-1 py-2 text-left text-[12px] font-extrabold tracking-[0.04em] text-[var(--fitting-ink)] underline"
                >
                  Retry
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {thisWeek ? (
        <p className="mt-2 text-[14px] leading-[1.55] text-[var(--fitting-ink)]">
          {thisWeek}
        </p>
      ) : null}
    </div>
  );
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
  twinReady: _twinReady = false,
  busy,
  accountReady = false,
  onSaveLooks,
  onFinish,
  ctaLabel: _ctaLabel,
}: Props) {
  const [fullReadingOpen, setFullReadingOpen] = useState(false);
  const [rail, setRail] = useState<ReadingLooksPayload>({
    looks: [],
    swatches: [],
    pending: false,
  });
  const [looksPollKey, setLooksPollKey] = useState(0);
  const lookIdsRef = useRef<string[]>([]);

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

  const skeletonLooks = useMemo((): LookCardPublic[] => {
    const contractLooks = verdict?.contract?.looks?.slice(0, FITTING_LOOK_COUNT) ?? [];
    return contractLooks.map((look, i) => ({
      id: `skeleton-${i}`,
      lookIndex: i,
      name: look.name,
      status: "queued",
      renderUrl: null,
      renderNote: null,
      pieces: look.pieces.map((spec, pi) => ({
        id: `skeleton-${i}-${pi}`,
        slot: spec.slot,
        spec,
        status: "pending",
        dropReason: null,
        observedFamily: null,
        product: null,
      })),
    }));
  }, [verdict]);

  const displayLooks =
    rail.looks.length > 0 ? rail.looks.slice(0, FITTING_LOOK_COUNT) : skeletonLooks;

  useEffect(() => {
    if (!verdict) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    const poll = async () => {
      const payload = await fetchReadingLooks().catch(
        (): ReadingLooksPayload => ({ looks: [], swatches: [], pending: false }),
      );
      if (!live) return;
      setRail(payload);
      lookIdsRef.current = payload.looks.map((l) => l.id);
      traceVerdict("looks-poll", {
        n: payload.looks.length,
        pending: payload.pending,
        ready: payload.looks.filter((l) => l.status === "ready").length,
      });
      const inFlight = payload.looks.some(
        (l) =>
          l.status === "queued" ||
          l.status === "products_ready" ||
          l.status === "rendering",
      );
      const waiting =
        payload.pending ||
        inFlight ||
        (payload.looks.length === 0 && Date.now() - startedAt < 120_000);
      if (waiting) {
        timer = setTimeout(() => void poll(), 2000);
      }
    };
    traceVerdict("looks-fetch");
    void poll();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [verdict, looksPollKey]);

  function retryLook(lookIndex: number) {
    setRail((prev) => ({
      ...prev,
      pending: true,
      looks: prev.looks.map((look) =>
        look.lookIndex === lookIndex
          ? { ...look, status: "queued", renderNote: null }
          : look,
      ),
    }));
    void guestFetch(`/api/onboarding/reading-looks/${lookIndex}/retry`, {
      method: "POST",
    }).finally(() => {
      setLooksPollKey((n) => n + 1);
    });
  }

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
        {reading.whoYouAre || reading.opening}
      </p>
      {reading.theShift ? (
        <p className="mt-3 text-[14.5px] leading-[1.62] text-[var(--fitting-ink)]">
          {reading.theShift}
        </p>
      ) : null}

      <div className="mt-8">
        <LooksOnYouRail
          looks={displayLooks}
          pending={rail.pending}
          thisWeek={reading.thisWeek}
          onRetry={retryLook}
        />
      </div>

      {reading.rules.length ? (
        <div className="mt-8 border-t border-[var(--fitting-line)] pt-7">
          <FittingKick>THREE RULES I&apos;LL HOLD YOU TO</FittingKick>
          <ul className="mt-3 list-none">
            {reading.rules.map((r) => {
              const [rule, why] = r.text.split(" — ");
              return (
                <li
                  key={`${r.ok}-${r.text}`}
                  className="border-t border-[var(--fitting-line)] py-3 first:border-0"
                >
                  <span className="font-display text-[15px] font-extrabold">
                    {rule}
                  </span>
                  {why ? (
                    <span className="mt-1 block text-[13px] leading-[1.45] text-[var(--fitting-quiet)]">
                      {why}
                    </span>
                  ) : null}
                </li>
              );
            })}
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

      {reading.palette.length ? (
        <div className="mt-8 border-t border-[var(--fitting-line)] pt-7">
          <FittingKick>YOUR COLORS, FROM YOUR FACE</FittingKick>
          {rail.swatches.some((s) => s.kind === "yes" && s.status === "rendering") ? (
            <p className="mt-1.5 text-[12.5px] leading-[1.45] text-[var(--fitting-quiet)]">
              Dressing each colour on you — not a product photo.
            </p>
          ) : null}
          <div className="mt-3 grid grid-cols-3 gap-2.5 sm:grid-cols-6">
            {reading.palette.map((s, i) => {
              const row = rail.swatches.filter((x) => x.kind === "yes")[i];
              return (
                <ColorSwatch
                  key={s.name}
                  hex={s.hex}
                  photo={row?.renderUrl}
                  products={row?.shopProducts}
                  caption={s.name}
                  loading={row?.status === "queued" || row?.status === "rendering"}
                />
              );
            })}
          </div>
          {reading.avoid.length ? (
            <div className="mt-5">
              <div className="mb-3 font-display text-[9.5px] font-extrabold tracking-[0.15em] text-[#DC2626]">
                NEVER NEXT TO YOUR FACE
              </div>
              <div className="grid max-w-[280px] grid-cols-2 gap-2.5">
                {reading.avoid.map((s, i) => {
                  const row = rail.swatches.filter((x) => x.kind === "no")[i];
                  return (
                    <ColorSwatch
                      key={s.name}
                      hex={s.hex}
                      photo={row?.renderUrl}
                      products={row?.shopProducts}
                      struck
                      caption={s.use ? `${s.name} — ${s.use}` : s.name}
                      loading={row?.status === "queued" || row?.status === "rendering"}
                    />
                  );
                })}
              </div>
            </div>
          ) : null}
          {reading.paletteLine ? (
            <p className="mt-3.5 text-[13px] leading-[1.65] text-[var(--fitting-quiet)]">
              {reading.paletteLine}
            </p>
          ) : null}
        </div>
      ) : verdict && !reading.palette.length ? (
        <div className="mt-8 rounded-2xl border border-dashed border-[var(--fitting-line)] bg-[#FAFAFB] px-4 py-5">
          <p className="font-display text-[15px] font-extrabold">
            Add a photo to see your colours on you
          </p>
          <p className="mt-1 text-[13px] leading-[1.5] text-[var(--fitting-quiet)]">
            The reading still stands. A face photo unlocks the yes/no strip.
          </p>
        </div>
      ) : null}

      {reading.fullProfile ||
      reading.silhouetteChips.length ||
      reading.fabricChips.length ? (
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
                  {fullReadingOpen ? "Hide the full profile" : "The full profile"}
                </span>
                <span className="mt-0.5 block text-[13px] font-semibold leading-[1.4] text-[var(--fitting-red)]">
                  Silhouette, fabrics, patterns, shoes
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
            {!fullReadingOpen && reading.fullProfile ? (
              <span className="relative mt-3 block max-h-[4.6em] overflow-hidden rounded-xl bg-white/80 px-3 py-2.5 text-[13px] leading-[1.5] text-[var(--fitting-quiet)]">
                {reading.fullProfile}
                <span className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[#FAFAFB] to-transparent" />
              </span>
            ) : null}
          </button>
          {fullReadingOpen ? (
            <div className="pt-4">
              {reading.fullProfile ? (
                <p className="text-[14px] leading-[1.65] text-[var(--fitting-ink)]">
                  {reading.fullProfile}
                </p>
              ) : null}
              {reading.silhouetteChips.length ? (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {reading.silhouetteChips.map((c) => (
                    <span
                      key={c}
                      className="rounded-full bg-[#F0F0F2] px-2.5 py-1 text-[11px] font-semibold"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              ) : null}
              {reading.fabricChips.length || reading.patternChips.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[...reading.fabricChips, ...reading.patternChips].map((c) => (
                    <span
                      key={c}
                      className="rounded-full border border-[var(--fitting-line)] px-2.5 py-1 text-[11px] font-semibold text-[var(--fitting-quiet)]"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
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
            ? "I’ll keep every look on your moodboard — in your size, with what we need to check out. Then we close the Fitting."
            : "Log in so I can save these looks to your moodboard — in your size, ready to buy. Then we close the Fitting."}
        </p>
        <div className="mt-[18px] flex flex-wrap items-center gap-2.5">
          <FittingCta
            onClick={() => {
              const jobIds = lookIdsRef.current;
              if (onSaveLooks) {
                onSaveLooks(jobIds);
                return;
              }
              onFinish?.();
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
          {onFinish ? (
            <button
              type="button"
              onClick={onFinish}
              className="text-[12.5px] font-semibold text-[#B4B4C0] underline-offset-2 hover:text-white hover:underline"
            >
              Finish without saving looks
            </button>
          ) : null}
        </div>
      </footer>

    </section>
  );
}
