"use client";

import { useCallback, useMemo, useRef } from "react";
import { ShoopIcon } from "@/components/brand/ShoopBrand";
import { cn } from "@/lib/ai-chat/cn";
import type { BuildKey, MirrorState, SilhouetteForm } from "./types";

type BodyShapeKey = NonNullable<MirrorState["bodyShape"]>;
type MuscularityKey = NonNullable<MirrorState["muscularity"]>;
type BustKey = NonNullable<MirrorState["bustFullness"]>;

/**
 * Parametric mock twin — same control points every time so CSS can ease
 * width changes when build / definition / shape / bust update.
 */
function buildMirrorBodyPath(opts: {
  form: SilhouetteForm;
  build: BuildKey | null;
  muscularity: MuscularityKey | null;
  bodyShape: BodyShapeKey | null;
  bustFullness: BustKey | null;
}): string {
  const cx = 60;

  // Base half-widths by gender presentation.
  let sh = 28;
  let ch = 27;
  let mid = 24;
  let wa = 23;
  let hi = 26;
  let th = 25;
  if (opts.form === "m") {
    sh = 34;
    ch = 32;
    mid = 28;
    wa = 25;
    hi = 27;
    th = 26;
  } else if (opts.form === "f") {
    sh = 26;
    ch = 29;
    mid = 24;
    wa = 21;
    hi = 30;
    th = 27;
  }

  switch (opts.bodyShape) {
    case "rectangle":
      sh *= 1.0;
      ch *= 0.98;
      mid *= 1.02;
      wa *= 1.08;
      hi *= 1.0;
      break;
    case "triangle":
      sh *= 0.88;
      ch *= 0.92;
      mid *= 0.98;
      wa *= 1.0;
      hi *= 1.2;
      th *= 1.08;
      break;
    case "inverted_triangle":
      sh *= 1.2;
      ch *= 1.14;
      mid *= 1.04;
      wa *= 0.92;
      hi *= 0.86;
      th *= 0.9;
      break;
    case "hourglass":
      sh *= 1.04;
      ch *= 1.08;
      mid *= 0.9;
      wa *= 0.76;
      hi *= 1.14;
      break;
    case "oval":
      sh *= 0.96;
      ch *= 1.04;
      mid *= 1.18;
      wa *= 1.16;
      hi *= 1.08;
      th *= 1.04;
      break;
    default:
      break;
  }

  const buildScale: Record<BuildKey, number> = {
    slim: 0.86,
    average: 1,
    athletic: 1.07,
    broad: 1.15,
    plus: 1.26,
  };
  const b = buildScale[opts.build ?? "average"];
  sh *= b;
  ch *= b;
  mid *= b;
  wa *= b;
  hi *= b;
  th *= b;

  // Athletic build + definition: V-taper extra.
  if (opts.build === "athletic") {
    sh *= 1.04;
    ch *= 1.03;
    wa *= 0.94;
  }

  if (opts.muscularity === "low") {
    sh *= 0.96;
    ch *= 0.97;
    mid *= 1.05;
    wa *= 1.07;
    hi *= 1.02;
  } else if (opts.muscularity === "high") {
    sh *= 1.1;
    ch *= 1.12;
    mid *= 0.96;
    wa *= 0.88;
    hi *= 0.95;
    th *= 0.96;
  } else if (opts.muscularity === "moderate") {
    ch *= 1.02;
    wa *= 0.97;
  }

  if (opts.form !== "m" && opts.bustFullness) {
    const bust: Record<BustKey, number> = {
      subtle: 0.9,
      average: 1,
      full: 1.12,
      very_full: 1.22,
    };
    ch *= bust[opts.bustFullness];
  }

  // Soft clamp so path stays inside viewBox.
  const clamp = (w: number) => Math.min(48, Math.max(12, w));
  sh = clamp(sh);
  ch = clamp(ch);
  mid = clamp(mid);
  wa = clamp(wa);
  hi = clamp(hi);
  th = clamp(th);

  const top = 22;
  const shY = 46;
  const chY = 70;
  const midY = 90;
  const waY = 108;
  const hiY = 132;
  const thY = 158;
  const bot = 176;
  const R = (w: number) => cx + w;
  const L = (w: number) => cx - w;

  // Fixed command count for all variants (eases visual morph).
  return [
    `M ${cx} ${top}`,
    `C ${R(sh * 0.4)} ${top} ${R(sh)} ${shY - 12} ${R(sh)} ${shY}`,
    `C ${R(sh)} ${shY + 12} ${R(ch)} ${chY - 8} ${R(ch)} ${chY}`,
    `C ${R(ch)} ${chY + 10} ${R(mid)} ${midY - 6} ${R(mid)} ${midY}`,
    `C ${R(mid)} ${midY + 8} ${R(wa)} ${waY - 6} ${R(wa)} ${waY}`,
    `C ${R(wa)} ${waY + 10} ${R(hi)} ${hiY - 8} ${R(hi)} ${hiY}`,
    `C ${R(hi)} ${hiY + 12} ${R(th)} ${thY - 8} ${R(th)} ${thY}`,
    `C ${R(th * 0.9)} ${bot - 4} ${R(8)} ${bot} ${cx} ${bot}`,
    `C ${L(8)} ${bot} ${L(th * 0.9)} ${bot - 4} ${L(th)} ${thY}`,
    `C ${L(th)} ${thY - 8} ${L(hi)} ${hiY + 12} ${L(hi)} ${hiY}`,
    `C ${L(hi)} ${hiY - 8} ${L(wa)} ${waY + 10} ${L(wa)} ${waY}`,
    `C ${L(wa)} ${waY - 6} ${L(mid)} ${midY + 8} ${L(mid)} ${midY}`,
    `C ${L(mid)} ${midY - 6} ${L(ch)} ${chY + 10} ${L(ch)} ${chY}`,
    `C ${L(ch)} ${chY - 8} ${L(sh)} ${shY + 12} ${L(sh)} ${shY}`,
    `C ${L(sh)} ${shY - 12} ${L(sh * 0.4)} ${top} ${cx} ${top}`,
    "Z",
  ].join(" ");
}

type Props = {
  mirror: MirrorState;
  onTell?: (text: string) => void;
  tellFeedback?: string | null;
  tellBusy?: boolean;
};

export function FittingMirror({
  mirror,
  onTell,
  tellFeedback,
  tellBusy,
}: Props) {
  const printRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const formPath = useMemo(
    () =>
      buildMirrorBodyPath({
        form: mirror.form,
        build: mirror.build,
        muscularity: mirror.muscularity,
        bodyShape: mirror.bodyShape,
        bustFullness: mirror.bustFullness,
      }),
    [
      mirror.form,
      mirror.build,
      mirror.muscularity,
      mirror.bodyShape,
      mirror.bustFullness,
    ],
  );

  const heightPct =
    mirror.heightCm != null
      ? 86 + (Math.max(140, Math.min(210, mirror.heightCm)) - 150) * 0.22
      : 94;

  // Mild width nudge from build so slim/plus still reads even if shape dominates path.
  const scaleX = mirror.build
    ? (
        {
          slim: 0.96,
          average: 1,
          athletic: 1.02,
          broad: 1.05,
          plus: 1.08,
        } as const
      )[mirror.build]
    : 1;

  const onMove = useCallback((e: React.MouseEvent) => {
    const el = printRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty(
      "--mx",
      `${((e.clientX - r.left) / r.width) * 100}%`,
    );
    el.style.setProperty(
      "--my",
      `${((e.clientY - r.top) / r.height) * 100}%`,
    );
  }, []);

  const submitTell = () => {
    if (tellBusy) return;
    const v = inputRef.current?.value.trim();
    if (!v || !onTell) return;
    onTell(v);
    if (inputRef.current) inputRef.current.value = "";
  };

  const lines: Array<{ id: string; label: string; value: string; red?: boolean }> =
    [
      { id: "era", label: "Era", value: mirror.eraLabel || "—" },
      { id: "spend", label: "Spend", value: mirror.spendLabel || "—" },
      { id: "lean", label: "Leaning", value: mirror.leanLabel || "—" },
      { id: "brands", label: "Brands", value: mirror.brandsLabel || "—" },
      {
        id: "no",
        label: "No-list",
        value: mirror.noListLabel || "—",
        red: true,
      },
      { id: "circle", label: "Circle", value: mirror.circleLabel || "—" },
    ];

  return (
    <div className="sticky top-3 flex h-[calc(100dvh-24px)] flex-col overflow-auto rounded-[18px] border border-[var(--fitting-line)] bg-gradient-to-b from-[#FCFCFD] to-[#F5F5F7] px-[18px] py-4">
      <div className="mb-2.5 flex items-baseline justify-between">
        <span className="text-[9.5px] font-extrabold tracking-[0.22em] text-[var(--fitting-ink)]">
          THE MIRROR
        </span>
        <span className="text-[9px] font-semibold text-[var(--fitting-quiet)]">
          {mirror.developPct >= 100 ? "dressed · " : "developing · "}
          <b className="text-[var(--fitting-red)]">{mirror.developPct}%</b>
        </span>
      </div>

      <div
        ref={printRef}
        onMouseMove={onMove}
        className="relative aspect-[5/7] overflow-hidden rounded-2xl border border-[var(--fitting-line)] bg-white shadow-[0_18px_40px_-24px_rgba(14,14,17,0.22)]"
      >
        <div
          className="fitting-motion pointer-events-none absolute inset-0 z-[6] opacity-0 transition-opacity duration-[1.2s]"
          style={{
            opacity: mirror.foil ? 0.28 : 0,
            background:
              "radial-gradient(120% 90% at var(--mx,30%) var(--my,20%),rgba(255,255,255,.45) 0%,transparent 45%),conic-gradient(from 210deg at 50% 50%,#ffd5c8,#e8c7f0,#c3e7f6,#d9f6c3,#fff3c3,#ffd5c8)",
            filter: "saturate(0.8)",
          }}
        />
        <div className="absolute inset-0 flex flex-col p-4 text-[var(--fitting-ink)]">
          <div className="flex items-baseline justify-between">
            <span
              className={cn(
                "fitting-motion min-h-[22px] font-display text-[17px] font-black tracking-[0.03em] transition-colors duration-500",
                mirror.name ? "text-[var(--fitting-ink)]" : "text-[#C9C9CF]",
              )}
            >
              {mirror.name ? mirror.name.toUpperCase() : "UNCLAIMED"}
            </span>
            <span className="text-[8px] font-extrabold tracking-[0.18em] text-[var(--fitting-red)]">
              1st&nbsp;edition
            </span>
          </div>
          <div
            className={cn(
              "fitting-motion mt-1 text-[8px] font-extrabold tracking-[0.2em] transition-colors duration-500",
              mirror.eraLabel ? "text-[var(--fitting-red)]" : "text-[#C9C9CF]",
            )}
          >
            {mirror.eraLabel
              ? `${mirror.eraLabel} era`
              : "era... still guessing"}
          </div>

          <div className="relative my-2 min-h-[180px] flex-1">
            {mirror.twinAvatarUrl && mirror.twinStatus === "ready" ? (
              /* Full FASHN twin (or dressed worn look on verdict). */
              <div
                className="fitting-motion absolute inset-x-0 bottom-0 top-1 flex items-end justify-center"
                key={mirror.twinAvatarUrl}
              >
                <div className="relative flex h-full max-h-full w-[min(100%,168px)] items-end justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={mirror.twinAvatarUrl}
                    alt=""
                    className={cn(
                      "fitting-motion max-h-full max-w-full object-contain object-bottom drop-shadow-[0_10px_18px_rgba(14,14,17,0.12)] animate-[fitting-twin-in_0.7s_ease-out]",
                      mirror.dressStatus === "dressing" &&
                        "animate-[fitting-blink_1.8s_infinite] opacity-90",
                    )}
                  />
                </div>
              </div>
            ) : (
              <div
                className="fitting-motion absolute bottom-1.5 left-1/2 flex w-[150px] -translate-x-1/2 flex-col items-center transition-[height] duration-700 ease-out"
                style={{ height: `${heightPct}%` }}
              >
                <div
                  className={cn(
                    "fitting-motion relative z-[2] mb-[-14px] h-12 w-12 rounded-full bg-[#DEDEE4] transition-all duration-700",
                    mirror.photoUrl &&
                      "outline outline-2 outline-[var(--fitting-line)] [filter:blur(2.5px)_saturate(0.9)]",
                    mirror.twinStatus === "developing" &&
                      mirror.photoUrl &&
                      "animate-[fitting-blink_1.8s_infinite] outline-[var(--fitting-red)]/30",
                    mirror.developPct >= 14 &&
                      !mirror.photoUrl &&
                      "bg-[#D4D4DC]",
                    mirror.developPct >= 26 &&
                      !mirror.photoUrl &&
                      "bg-gradient-to-br from-[#E8DDD0] to-[#C4B4A2]",
                  )}
                  style={
                    mirror.photoUrl
                      ? {
                          backgroundImage: `url(${mirror.photoUrl})`,
                          backgroundSize: "cover",
                          backgroundPosition: "center",
                        }
                      : undefined
                  }
                />
                <svg
                  className="fitting-motion h-auto w-full flex-1 transition-transform duration-700 ease-out"
                  viewBox="0 0 120 226"
                  xmlns="http://www.w3.org/2000/svg"
                  style={{
                    transformOrigin: "50% 100%",
                    transform: `scaleX(${scaleX})`,
                  }}
                >
                  <defs>
                    <linearGradient id="formGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="#E2E2E8" />
                      <stop offset=".55" stopColor="#CFCFD8" />
                      <stop offset="1" stopColor="#BDBDC8" />
                    </linearGradient>
                    <linearGradient id="formSheen" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0" stopColor="#fff" stopOpacity=".10" />
                      <stop offset=".4" stopColor="#fff" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path
                    d={formPath}
                    className="fitting-motion"
                    style={{ transition: "d 0.65s ease-out" }}
                    fill={
                      mirror.developPct >= 34
                        ? "url(#formGrad)"
                        : mirror.developPct >= 14
                          ? "#D4D4DC"
                          : "#DEDEE4"
                    }
                  />
                  <path
                    d={formPath}
                    fill="url(#formSheen)"
                    style={{ transition: "d 0.65s ease-out" }}
                  />
                  <rect
                    x="58"
                    y="176"
                    width="4"
                    height="26"
                    rx="2"
                    fill="#C7C7CF"
                  />
                  <rect
                    x="36"
                    y="202"
                    width="48"
                    height="7"
                    rx="3.5"
                    fill="#C7C7CF"
                  />
                </svg>
              </div>
            )}
          </div>

          <div className="flex min-h-[56px] flex-col gap-1">
            {lines.map((line) => {
              const lit = line.value !== "—";
              return (
                <div
                  key={line.id}
                  className={cn(
                    "fitting-motion flex justify-between text-[9px] font-bold tracking-[0.12em] transition-all duration-500",
                    lit
                      ? "translate-y-0 text-[#8A8A93] opacity-100"
                      : "translate-y-1 text-[#C3C3CB] opacity-40",
                  )}
                >
                  <span>{line.label}</span>
                  <b
                    className={
                      line.red && lit
                        ? "text-[var(--fitting-red)]"
                        : "text-[var(--fitting-ink)]"
                    }
                  >
                    {line.value}
                  </b>
                </div>
              );
            })}
          </div>

          <div className="mt-2 flex items-center gap-1.5">
            <span className="mr-0.5 text-[8.5px] font-bold tracking-[0.06em] text-[#B3B3BC]">
              closet
            </span>
            {[0, 1, 2].map((i) => {
              const img = mirror.closetImages[i];
              return (
                <span
                  key={i}
                  className={cn(
                    "fitting-motion relative h-[34px] w-7 overflow-hidden rounded-[7px] border-[1.5px] border-dashed border-[#E0E0E6] transition-all duration-300",
                    img &&
                      "border-solid border-[rgba(14,14,17,0.15)] shadow-[inset_0_0_0_1px_rgba(14,14,17,0.08)]",
                  )}
                >
                  {img ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={img}
                      alt=""
                      className="absolute inset-0 size-full object-cover"
                    />
                  ) : null}
                </span>
              );
            })}
          </div>

          {mirror.twinStatus !== "idle" || mirror.dressStatus !== "idle" ? (
            <div
              className={cn(
                "mt-1.5 flex items-center gap-1.5 text-[9px] font-bold tracking-[0.04em] text-[var(--fitting-quiet)]",
                (mirror.dressStatus === "ready" ||
                  (mirror.dressStatus === "idle" &&
                    mirror.twinStatus === "ready")) &&
                  "text-[#2BB673]",
                (mirror.dressStatus === "error" ||
                  mirror.twinStatus === "error") &&
                  "text-[var(--fitting-red)]",
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full bg-[var(--fitting-red)]",
                  (mirror.twinStatus === "developing" ||
                    mirror.dressStatus === "dressing") &&
                    "animate-[fitting-blink_1.2s_infinite]",
                  (mirror.dressStatus === "ready" ||
                    (mirror.dressStatus === "idle" &&
                      mirror.twinStatus === "ready")) &&
                    "bg-[#2BB673]",
                )}
              />
              {mirror.dressStatus === "dressing"
                ? mirror.dressStyleLabel
                  ? `dressing you in ${mirror.dressStyleLabel}...`
                  : "dressing your twin..."
                : mirror.dressStatus === "ready"
                  ? mirror.dressStyleLabel
                    ? `dressed · ${mirror.dressStyleLabel}`
                    : "dressed · worn look on twin"
                  : mirror.dressStatus === "error"
                    ? mirror.dressError ??
                      "dress failed — twin still here undressed"
                    : mirror.twinStatus === "ready"
                      ? "twin ready... minted while you answered"
                      : mirror.twinStatus === "error"
                        ? (mirror.twinError ??
                          "twin mint failed — retry from Mirror later")
                        : "Shoop is building your twin..."}
            </div>
          ) : null}

          <div className="mt-2.5 flex items-end justify-between text-[7px] font-extrabold tracking-[0.14em] text-[#C3C3CB]">
            <span className="text-[9px] text-[var(--fitting-ink)]">
              № {mirror.serial}
            </span>
            <span>Shoop · S/S 2026</span>
          </div>
        </div>
      </div>

      {onTell ? (
        <div className="mt-4">
          <div
            className={cn(
              "flex items-center gap-2 rounded-2xl border border-[#D6D6DE] bg-white py-1.5 pl-3.5 pr-1.5 shadow-[0_10px_26px_-14px_rgba(14,14,17,0.25)]",
              tellBusy && "opacity-70",
            )}
          >
            <ShoopIcon size={16} className="rounded-[4px]" />
            <input
              ref={inputRef}
              disabled={tellBusy}
              placeholder="Write anything... I'll fill the form"
              className="min-w-0 flex-1 border-none bg-transparent text-xs text-[var(--fitting-ink)] outline-none placeholder:text-[var(--fitting-quiet)] disabled:cursor-wait"
              onKeyDown={(e) => {
                if (e.key === "Enter") submitTell();
              }}
            />
            <button
              type="button"
              disabled={tellBusy}
              onClick={submitTell}
              className="h-[34px] rounded-[10px] bg-[var(--fitting-ink)] px-3.5 font-display text-[11.5px] font-extrabold text-white disabled:opacity-60"
            >
              {tellBusy ? "…" : "Tell me"}
            </button>
          </div>
          <div
            className={cn(
              "mt-1 min-h-[13px] text-center text-[10.5px] font-bold text-[#2BB673]",
              tellFeedback?.startsWith("Couldn't") ||
                tellFeedback?.startsWith("Network") ||
                tellFeedback?.startsWith("Could not")
                ? "text-[var(--fitting-red)]"
                : null,
              tellBusy && "text-[var(--fitting-quiet)]",
            )}
          >
            {tellFeedback ?? ""}
          </div>
        </div>
      ) : null}
    </div>
  );
}
