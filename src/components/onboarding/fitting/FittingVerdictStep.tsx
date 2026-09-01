"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/ai-chat/cn";
import { FittingCta, FittingKick, FittingWhisper } from "@/components/onboarding/onboarding-ui";
import { guestFetch } from "@/lib/client/guest-fetch";
import type { StyleMix } from "@/lib/onboarding/style-mix";
import {
  productForStep,
  uniqueLookProducts,
  type ReadingLookItem,
  type ReadingLookProduct,
} from "@/lib/photo-analysis/reading-looks";
import { buildReadingView } from "@/lib/photo-analysis/verdict-reading";
import type { StylistVerdict } from "@/lib/photo-analysis/verdict";
import { catalogDisplayImageUrl, CATALOG_IMAGE_PX } from "@/lib/shopify/catalog-display-image";
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
  dressStatus?: "idle" | "dressing" | "ready" | "error";
  dressStyleLabel?: string | null;
  dressedLookUrl?: string | null;
  busy?: boolean;
  onMeetTwin: () => void;
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

function formatLookPrice(
  price: ReadingLookProduct["price"],
): string | null {
  if (!price || !Number.isFinite(price.amount)) return null;
  const value = price.amount / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: price.currency,
      maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    }).format(value);
  } catch {
    return null;
  }
}

function ReadingProductTile({
  product,
  caption,
}: {
  product: ReadingLookProduct;
  caption?: string;
}) {
  const price = formatLookPrice(product.price);
  return (
    <figure className="min-w-0">
      <div className="relative aspect-[3/4] overflow-hidden rounded-xl bg-[#F3F3F5]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={catalogDisplayImageUrl(product.imageUrl, CATALOG_IMAGE_PX.stack)}
          alt=""
          className="size-full object-cover"
        />
      </div>
      <figcaption className="mt-2">
        <p className="line-clamp-2 font-display text-[12px] font-extrabold leading-[1.3] text-[var(--fitting-ink)]">
          {product.title}
        </p>
        {caption ? (
          <p className="mt-0.5 text-[10.5px] leading-[1.4] text-[var(--fitting-quiet)]">
            {caption}
          </p>
        ) : null}
        {price ? (
          <p className="mt-0.5 text-[11px] font-semibold text-[var(--fitting-quiet)]">
            {price}
          </p>
        ) : null}
      </figcaption>
    </figure>
  );
}
function ColorSwatch({
  hex,
  name,
  use,
  struck,
}: {
  hex: string;
  name: string;
  use: string;
  struck?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div
        className={cn(
          "relative aspect-[4/5] overflow-hidden rounded-xl",
          struck && "saturate-[0.85]",
        )}
        style={{
          background: `radial-gradient(80% 60% at 50% 18%, #FDFDFE 0%, ${hex}55 50%, ${hex} 100%)`,
        }}
      >
        <div
          className="absolute inset-x-[18%] bottom-[22%] top-[38%] rounded-t-[40%]"
          style={{ background: hex }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[rgba(26,26,46,0.42)]" />
        {struck ? (
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "linear-gradient(135deg, transparent calc(50% - 1px), rgba(220,38,38,0.5) 50%, transparent calc(50% + 1px))",
            }}
          />
        ) : null}
        <span className="absolute bottom-2 left-2.5 right-2 font-display text-[9.5px] font-extrabold tracking-[0.11em] text-white drop-shadow">
          {name}
        </span>
      </div>
      {use && use.toUpperCase() !== name.toUpperCase() ? (
        <p className="mt-2 text-[11px] leading-[1.45] text-[var(--fitting-quiet)]">
          {use}
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
  developPct,
  circleNames = [],
  dressStatus = "idle",
  dressStyleLabel = null,
  dressedLookUrl = null,
  busy,
  onMeetTwin,
  ctaLabel,
  onShare,
  shareCopied,
}: Props) {
  const cleanedCircle = circleNames.map((n) => n.trim()).filter(Boolean);
  const cleanedKey = cleanedCircle.join("\0");
  const [selectedCircle, setSelectedCircle] = useState<string[]>(cleanedCircle);
  const [openArea, setOpenArea] = useState<string | null>(null);
  const [looks, setLooks] = useState<ReadingLookItem[] | null>(null);

  useEffect(() => {
    setSelectedCircle(cleanedCircle);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when names change
  }, [cleanedKey]);

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
    let cancelled = false;
    void guestFetch("/api/onboarding/reading-looks")
      .then(async (res) => {
        if (!res.ok) return [] as ReadingLookItem[];
        const json = (await res.json()) as { items?: ReadingLookItem[] };
        return Array.isArray(json.items) ? json.items : [];
      })
      .catch(() => [] as ReadingLookItem[])
      .then((items) => {
        if (!cancelled) setLooks(items);
      });
    return () => {
      cancelled = true;
    };
  }, [verdict]);

  function toggleCircle(name: string) {
    setSelectedCircle((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  }

  function toggleArea(id: string) {
    setOpenArea((prev) => (prev === id ? null : id));
  }

  const lookGroups = useMemo(() => {
    const groups: Array<{
      id: string;
      label: string;
      products: ReadingLookProduct[];
    }> = [];
    const byId = new Map<string, (typeof groups)[number]>();
    for (const item of looks ?? []) {
      if (item.kind !== "look" || !item.product || !item.lookId) continue;
      let group = byId.get(item.lookId);
      if (!group) {
        group = {
          id: item.lookId,
          label: item.lookLabel || "A look",
          products: [],
        };
        byId.set(item.lookId, group);
        groups.push(group);
      }
      group.products.push(item.product);
    }
    for (const group of groups) {
      group.products = uniqueLookProducts(group.products);
    }
    const buys = (looks ?? [])
      .filter((item) => item.kind === "buy" && item.product)
      .map((item) => item.product!);
    const used = new Set(groups.flatMap((g) => g.products.map((p) => p.id)));
    const leftover = uniqueLookProducts(buys.filter((p) => !used.has(p.id)));
    if (leftover.length) {
      groups.push({
        id: "buy",
        label: "First to get",
        products: leftover,
      });
    }
    return groups;
  }, [looks]);

  const noteCount = Math.max(
    reading.areas.filter((a) => a.verdict === "n").length,
    reading.steps.length,
    3,
  );

  return (
    <section className="max-w-[720px] pb-4">
      <FittingKick>DONE</FittingKick>
      <h1 className="font-display text-[clamp(26px,3.6vw,40px)] font-black leading-[0.97] tracking-[-0.045em] text-[var(--fitting-ink)]">
        {first ? `${first}, here's` : "Here's"}
        <br />
        what I <span className="text-[var(--fitting-red)]">see.</span>
      </h1>
      <p className="mt-3 max-w-[530px] text-[14.5px] leading-[1.62] text-[var(--fitting-quiet)] [&_b]:font-semibold [&_b]:text-[var(--fitting-ink)]">
        {reading.headline ? (
          <>
            <b>{reading.headline}.</b>{" "}
          </>
        ) : null}
        {reading.opening}{" "}
        <b>Open any area</b> for the rest of what I found there.
        {vetoCount > 0 ? (
          <>
            {" "}
            Your <b>{vetoCount} hard vetoes</b> stay locked.
          </>
        ) : null}
      </p>

        {lookGroups.length || (verdict && looks === null) ? (
          <div className="mt-8 border-t border-[var(--fitting-line)] pt-7">
            <div className="mb-1 font-display text-[10px] font-black tracking-[0.14em] text-[#C4C4CC]">
              FIRST
            </div>
            <FittingKick>YOUR WEEK, DRESSED</FittingKick>
            <h2 className="mb-4 font-display text-[clamp(22px,2.6vw,28px)] font-black leading-[1.08] tracking-[-0.03em]">
              Five looks on you — not catalog stills.
            </h2>
            {lookGroups.length ? (
              <div className="flex flex-col gap-6">
                {lookGroups.map((group) => (
                  <div key={group.id}>
                    <div className="mb-3 font-display text-[13px] font-extrabold tracking-[-0.02em]">
                      {group.label}
                    </div>
                    {dressedLookUrl ? (
                      <div className="mb-2.5 overflow-hidden rounded-2xl bg-[#F4F4F6]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={dressedLookUrl}
                          alt=""
                          className="aspect-[3/4] w-full object-cover object-top"
                        />
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                        {group.products.map((product) => (
                          <ReadingProductTile
                            key={product.id}
                            product={product}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="font-whisper text-[15px] italic text-[var(--fitting-quiet)]">
                Dressing the looks on your twin…
              </p>
            )}
          </div>
        ) : null}

        {reading.steps.length >= 2 ? (
          <div className="mt-8 border-t border-[var(--fitting-line)] pt-7">
            <div className="mb-1 font-display text-[10px] font-black tracking-[0.14em] text-[#C4C4CC]">
              ONE OF FIVE
            </div>
            <FittingKick>THE DIFFERENCE</FittingKick>
            <h2 className="mb-4 font-display text-[clamp(22px,2.6vw,28px)] font-black leading-[1.08] tracking-[-0.03em] text-[var(--fitting-ink)]">
              {noteCount} ways to move from what you wear now.
            </h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {reading.steps.map((s) => {
                const piece = productForStep(s.why, looks ?? []);
                return (
                <div
                  key={s.step}
                  className="rounded-2xl border border-[var(--fitting-line)] bg-[#FAFAFB] p-3.5"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="font-display text-[9px] font-extrabold tracking-[0.16em] text-[var(--fitting-red)]">
                      {s.label}
                    </span>
                    <span className="grid size-[22px] place-items-center rounded-full bg-white font-display text-[11px] font-black text-[var(--fitting-ink)] shadow-sm">
                      {s.step}
                    </span>
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
                      <p className="line-clamp-2 px-2 py-1.5 font-display text-[11px] font-extrabold leading-[1.3]">
                        {piece.title}
                      </p>
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

        {reading.areas.length ? (
          <div className="mt-8 border-t border-[var(--fitting-line)] pt-7">
            <div className="mb-1 font-display text-[10px] font-black tracking-[0.14em] text-[#C4C4CC]">
              FOUR OF FIVE
            </div>
            <FittingKick>WHAT YOU CAN AND CANNOT</FittingKick>
            <h2 className="mb-4 font-display text-[clamp(22px,2.6vw,28px)] font-black leading-[1.08] tracking-[-0.03em]">
              {reading.areas.length} areas. Open any of them.
            </h2>
            <div className="flex flex-col gap-2">
              {reading.areas.map((a) => {
                const open = openArea === a.id;
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
                      <span
                        className="grid h-[52px] w-11 shrink-0 place-items-center overflow-hidden rounded-[9px]"
                        style={{
                          background: `linear-gradient(165deg, ${a.thumb}22, ${a.thumb}55)`,
                        }}
                      >
                        <span
                          className="block h-10 w-[30px] rounded-md"
                          style={{ background: a.thumb }}
                        />
                      </span>
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
                          a.verdict === "y"
                            ? "bg-[rgba(22,163,74,0.12)] text-[var(--fitting-good)]"
                            : "bg-[rgba(220,38,38,0.1)] text-[#DC2626]",
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
                              className="flex items-center justify-between gap-3 border-b border-[var(--fitting-line)] py-2.5 text-[12.5px] last:border-0"
                            >
                              <span className="font-semibold text-[var(--fitting-quiet)]">
                                {m.label}
                              </span>
                              <span
                                className={cn(
                                  "font-display text-[13px] font-black",
                                  m.tone === "hi" && "text-[var(--fitting-good)]",
                                  m.tone === "lo" && "text-[#DC2626]",
                                )}
                              >
                                {m.value}
                              </span>
                            </div>
                          ))}
                        </div>
                        <div className="mb-3">
                          <div className="mb-2 font-display text-[10px] font-extrabold tracking-[0.13em] text-[var(--fitting-red)]">
                            WHAT THIS MEANS
                          </div>
                          <p className="text-[13px] leading-[1.65] text-[var(--fitting-quiet)]">
                            {a.insight}
                          </p>
                        </div>
                        {a.recs.length ? (
                          <div>
                            <div className="mb-2 font-display text-[10px] font-extrabold tracking-[0.13em] text-[var(--fitting-red)]">
                              WHAT TO DO ABOUT IT
                            </div>
                            <ul className="list-none">
                              {a.recs.map((r) => (
                                <li
                                  key={`${r.ok}-${r.title}`}
                                  className="flex gap-2.5 border-t border-[var(--fitting-line)] py-2.5 text-[12.5px] leading-[1.5]"
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
                                  <span>
                                    <b className="mb-0.5 block font-display text-[13px] font-extrabold">
                                      {r.title}
                                    </b>
                                    {r.detail ? (
                                      <span className="text-[var(--fitting-quiet)]">
                                        {r.detail}
                                      </span>
                                    ) : null}
                                  </span>
                                </li>
                              ))}
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

        {reading.palette.length ? (
          <div className="mt-8 border-t border-[var(--fitting-line)] pt-7">
            <div className="mb-1 font-display text-[10px] font-black tracking-[0.14em] text-[#C4C4CC]">
              TWO OF FIVE
            </div>
            <FittingKick>FROM YOUR OWN SKIN, HAIR AND EYES</FittingKick>
            <h2 className="mb-4 font-display text-[clamp(22px,2.6vw,28px)] font-black leading-[1.08] tracking-[-0.03em]">
              {reading.palette.length} that suit you.
            </h2>
            <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-6">
              {reading.palette.map((s) => (
                <ColorSwatch key={s.name} hex={s.hex} name={s.name} use={s.use} />
              ))}
            </div>
            {reading.avoid.length ? (
              <div className="mt-5 border-t border-dashed border-[#D4D4D7] pt-5">
                <div className="mb-3 flex items-center gap-2 font-display text-[9.5px] font-extrabold tracking-[0.15em] text-[#DC2626]">
                  <i className="grid size-4 place-items-center rounded-full bg-[rgba(220,38,38,0.11)] text-[9px] font-extrabold not-italic">
                    ✕
                  </i>
                  AND THESE, NEVER NEXT TO YOUR FACE
                </div>
                <div className="grid max-w-[280px] grid-cols-2 gap-2.5">
                  {reading.avoid.map((s) => (
                    <ColorSwatch
                      key={s.name}
                      hex={s.hex}
                      name={s.name}
                      use={s.use}
                      struck
                    />
                  ))}
                </div>
              </div>
            ) : null}
            <p className="mt-3.5 text-[13px] leading-[1.65] text-[var(--fitting-quiet)] [&_b]:font-bold [&_b]:text-[var(--fitting-ink)]">
              Shown where they matter, <b>right up at your face</b> — that is
              where colour does the work.
            </p>
          </div>
        ) : null}

        {reading.mix.length ? (
          <div className="mt-8 border-t border-[var(--fitting-line)] pt-7">
            <div className="mb-1 font-display text-[10px] font-black tracking-[0.14em] text-[#C4C4CC]">
              YOUR MIX
            </div>
            <FittingKick>THE TASTE YOU PICKED</FittingKick>
            <h2 className="mb-4 font-display text-[clamp(22px,2.6vw,28px)] font-black leading-[1.08] tracking-[-0.03em]">
              This is the mix you picked.
            </h2>
            <TasteDonut mix={reading.mix} />
          </div>
        ) : null}

        <footer className="mt-8 overflow-hidden rounded-[20px] bg-[var(--fitting-ink)] px-6 py-7 text-white">
          <FittingKick>
            <span className="text-[#FF8A90]">NOW IT BECOMES YOURS</span>
          </FittingKick>
          <h3 className="font-display text-[25px] font-black tracking-[-0.035em]">
            That&apos;s you. Now the clothes.
          </h3>
          <p className="mt-2 text-[13.5px] leading-[1.6] text-[#B4B4C0]">
            Outfits for the week you&apos;ve actually got, on your own body.
            Every one follows what&apos;s above — and when something breaks a
            rule, I&apos;ll say so.
          </p>

          {cleanedCircle.length ? (
            <div className="mt-4">
              <div className="mb-2 font-display text-[10px] font-extrabold tracking-[0.14em] text-[#FF8A90]">
                SEND IT TO YOUR TRUSTED CIRCLE
              </div>
              <div className="flex flex-wrap">
                {cleanedCircle.map((name) => {
                  const on = selectedCircle.includes(name);
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => toggleCircle(name)}
                      className={cn(
                        "mb-1.5 mr-1.5 inline-flex items-center gap-1.5 rounded-full border-[1.5px] border-white/30 py-1.5 pl-1.5 pr-3.5 text-[12.5px] font-bold text-white transition-all",
                        on && "border-white bg-white text-[var(--fitting-ink)]",
                      )}
                    >
                      <span
                        className={cn(
                          "grid size-[22px] place-items-center rounded-full bg-white/16 text-[10px] font-extrabold",
                          on && "bg-[var(--fitting-ink)] text-white",
                        )}
                      >
                        {name.charAt(0).toUpperCase()}
                      </span>
                      {name}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="mt-[18px] flex flex-wrap gap-2.5">
            <FittingCta onClick={onMeetTwin} disabled={busy} inverse>
              {busy ? "Opening…" : ctaLabel ?? "Show me my looks"}
            </FittingCta>
            {onShare ? (
              <button
                type="button"
                onClick={() => onShare(selectedCircle)}
                className="h-12 rounded-xl border-[1.5px] border-white/30 bg-transparent px-5 font-display text-[13px] font-extrabold text-white transition hover:border-white hover:bg-white hover:text-[var(--fitting-ink)]"
              >
                {shareCopied
                  ? "Copied ✓"
                  : cleanedCircle.length && selectedCircle.length
                    ? "Ask my circle"
                    : "Share this"}
              </button>
            ) : null}
          </div>
        </footer>

      <FittingWhisper>
        {dressStatus === "dressing" ? (
          <>
            Shoop is putting{" "}
            <b>{dressStyleLabel ?? "your worn look"}</b> on your twin right
            now... {developPct}% and counting.
          </>
        ) : dressStatus === "ready" ? (
          <>
            {developPct}% · dressed in{" "}
            <b>{dressStyleLabel ?? "your worn look"}</b> on your twin.
          </>
        ) : (
          <>
            {developPct}% developed... your twin is on the right.{" "}
            <b>Your print gets a first-edition serial.</b>
          </>
        )}
      </FittingWhisper>
    </section>
  );
}
