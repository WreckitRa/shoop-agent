"use client";

import { useCallback, useRef } from "react";
import { ShoopIcon } from "@/components/brand/ShoopBrand";
import { cn } from "@/lib/ai-chat/cn";
import { BodyTwinSilhouette } from "./BodyTwinSilhouette";
import {
  silhouetteHeadOverlayStyle,
  SILHOUETTE_VIEWBOX,
} from "./bodySilhouetteGeometry";
import { FittingVerdictAnnotations } from "./FittingVerdictAnnotations";
import type { MirrorState } from "./types";

function formatTwinClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m <= 0 ? `${s}s` : `${m}:${s.toString().padStart(2, "0")}`;
}

type Props = {
  mirror: MirrorState;
  onTell?: (text: string) => void;
  tellFeedback?: string | null;
  tellBusy?: boolean;
  layout?: "page" | "column" | "figure" | "stage";
  /** Photo step: pick a face from the silhouette head. */
  onPickPhoto?: (file: File) => void;
  photoPickLocked?: boolean;
  /** Bigger add-photo chip when the twin sits under the questions. */
  photoCta?: "rail" | "flow" | "figure";
  /** Twin mint failed — print again from THE MIRROR. */
  onRetryTwin?: () => void;
};

function TwinFigure({
  mirror,
  bodyColor,
  heightPct,
  onPickPhoto,
  photoPickLocked,
  photoCta,
}: {
  mirror: MirrorState;
  bodyColor: string;
  heightPct: number;
  onPickPhoto?: (file: File) => void;
  photoPickLocked: boolean;
  photoCta: "rail" | "flow" | "figure";
}) {
  const HeadWrap = onPickPhoto ? "label" : "div";
  return (
    <div className="absolute inset-0 flex items-end justify-center [container-type:size]">
      <div
        className="fitting-motion relative"
        style={{
          width: `min(100%, calc(${heightPct}cqh * ${SILHOUETTE_VIEWBOX.w} / ${SILHOUETTE_VIEWBOX.h}))`,
          aspectRatio: `${SILHOUETTE_VIEWBOX.w} / ${SILHOUETTE_VIEWBOX.h}`,
          color: bodyColor,
        }}
      >
        <BodyTwinSilhouette
          className="h-full w-full"
          form={mirror.form}
          build={mirror.build}
          muscularity={mirror.muscularity}
          bodyShape={mirror.bodyShape}
          bustFullness={mirror.form === "f" ? mirror.bustFullness : null}
          legLine={mirror.legLine}
          heightCm={null}
          decorative
        />
        <HeadWrap
          className={cn(
            "absolute inset-0 z-[2]",
            onPickPhoto && !photoPickLocked && "cursor-pointer",
            onPickPhoto && photoPickLocked && "pointer-events-none opacity-40",
          )}
        >
          <span
            className={cn(
              "absolute aspect-square rounded-full transition-all duration-700",
              onPickPhoto &&
                !mirror.photoUrl &&
                "outline outline-2 outline-dashed outline-[var(--fitting-ink)]",
              mirror.photoUrl &&
                "outline outline-2 outline-[var(--fitting-line)] [filter:blur(2.5px)_saturate(0.9)]",
              mirror.twinStatus === "developing" &&
                mirror.photoUrl &&
                "animate-[fitting-blink_1.8s_infinite] outline-[var(--fitting-red)]/30",
              mirror.developPct >= 26 &&
                !mirror.photoUrl &&
                "bg-gradient-to-br from-[#E8DDD0] to-[#C4B4A2]",
            )}
            style={{
              ...silhouetteHeadOverlayStyle(),
              ...(mirror.photoUrl
                ? {
                    backgroundImage: `url(${mirror.photoUrl})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }
                : mirror.developPct >= 26
                  ? {}
                  : { backgroundColor: bodyColor }),
            }}
          />
          {onPickPhoto ? (
            <>
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={photoPickLocked}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onPickPhoto(f);
                  e.target.value = "";
                }}
              />
              <span className="sr-only">
                {mirror.photoUrl ? "Change face photo" : "Add a face photo"}
              </span>
              {!mirror.photoUrl ? (
                <span
                  className={cn(
                    "fitting-shot-cta absolute left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-[10px] bg-[var(--fitting-ink)] font-display font-extrabold text-white shadow-[0_10px_18px_-10px_rgba(14,14,17,.5)]",
                    photoCta === "figure"
                      ? "bottom-[34%] px-4 py-2.5 text-[13px]"
                      : photoCta === "flow"
                        ? "bottom-[22%] px-4 py-2.5 text-[13px]"
                        : "bottom-[20%] px-2.5 py-1.5 text-[10px]",
                  )}
                >
                  Add a face photo <span aria-hidden>→</span>
                </span>
              ) : null}
            </>
          ) : null}
        </HeadWrap>
      </div>
    </div>
  );
}

export function FittingMirror({
  mirror,
  onTell,
  tellFeedback,
  tellBusy,
  layout = "page",
  onPickPhoto,
  photoPickLocked = false,
  photoCta = "rail",
  onRetryTwin,
}: Props) {
  const printRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const bodyColor =
    mirror.developPct >= 34
      ? "#6A6A76"
      : mirror.developPct >= 14
        ? "#7C7C88"
        : "#8E8E9A";

  const heightPct =
    mirror.heightCm != null
      ? 90 + (Math.max(140, Math.min(210, mirror.heightCm)) - 150) * 0.16
      : 97;

  const onMove = useCallback((e: React.MouseEvent) => {
    const el = printRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
    el.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
  }, []);

  const submitTell = () => {
    if (tellBusy) return;
    const v = inputRef.current?.value.trim();
    if (!v || !onTell) return;
    onTell(v);
    if (inputRef.current) inputRef.current.value = "";
  };

  const lines: Array<{
    id: string;
    label: string;
    value: string;
    red?: boolean;
  }> = [
    { id: "era", label: "Era", value: mirror.eraLabel || "—" },
    { id: "spend", label: "Spend", value: mirror.spendLabel || "—" },
    { id: "brands", label: "Brands", value: mirror.brandsLabel || "—" },
    {
      id: "no",
      label: "Never again",
      value: mirror.noListLabel || "—",
      red: true,
    },
  ];

  const twinReady =
    Boolean(mirror.twinAvatarUrl) && mirror.twinStatus === "ready";
  const fillUrl = twinReady ? mirror.twinAvatarUrl : null;
  const twinFigure = (
    <TwinFigure
      mirror={mirror}
      bodyColor={bodyColor}
      heightPct={heightPct}
      onPickPhoto={onPickPhoto}
      photoPickLocked={photoPickLocked}
      photoCta={photoCta}
    />
  );

  if (layout === "figure") {
    return (
      <div className="relative mx-auto mt-6 h-[min(48vh,300px)] w-full max-w-[200px] text-[var(--fitting-ink)]">
        {twinFigure}
      </div>
    );
  }

  const scanLive =
    mirror.scanActivity === "reading" || mirror.scanActivity === "writing";
  const stageScanChrome = (
    <>
      {fillUrl ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={fillUrl}
            src={fillUrl}
            alt=""
            className={cn(
              "absolute inset-0 size-full object-cover object-top",
              twinReady
                ? "animate-[fitting-twin-in_0.7s_ease-out]"
                : "scale-[1.02]",
              mirror.dressStatus === "dressing" &&
                "animate-[fitting-blink_1.8s_infinite] opacity-90",
              mirror.twinStatus === "developing" &&
                !twinReady &&
                "animate-[fitting-blink_1.8s_infinite]",
            )}
          />
        </>
      ) : null}
      {mirror.scanActivity === "writing" ? (
        <FittingVerdictAnnotations compact={layout === "column"} />
      ) : null}
      <div className="absolute inset-0 z-[2] flex flex-col p-3">
        <div
          className={cn(
            "relative min-h-0 flex-1",
            layout === "column" ? "min-h-[120px]" : "min-h-[180px]",
          )}
        >
          {fillUrl ? null : twinFigure}
          {scanLive && mirror.dressStatus !== "dressing" ? (
            <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden">
              <i className="fitting-scan-line" />
              {mirror.scanActivity === "reading"
                ? mirror.scanNotes.slice(0, 4).map((note, i) => (
                    <div
                      key={note.label}
                      className={cn(
                        "shoop-sscan__anno lit",
                        `shoop-sscan__anno--${i + 1}`,
                      )}
                    >
                      {i % 2 === 1 ? <span className="tick" /> : null}
                      <span>
                        {note.label}
                        {note.value ? ` · ${note.value}` : ""}
                      </span>
                      {i % 2 === 0 ? <span className="tick" /> : null}
                    </div>
                  ))
                : null}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );

  if (layout === "stage") {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gradient-to-b from-[#FAFAFB] to-[#F0F0F2] px-4 pb-2 pt-3 text-[var(--fitting-ink)]">
        <div className="font-display text-[9.5px] font-extrabold tracking-[0.16em] text-[var(--fitting-quiet)]">
          YOUR TWIN
        </div>
        <div
          ref={printRef}
          onMouseMove={onMove}
          className="relative mt-2 min-h-0 flex-1 overflow-hidden rounded-2xl bg-[radial-gradient(70%_52%_at_50%_20%,#FFF,#F2F2F4_52%,#E2E2E6_100%)]"
        >
          <div
            className={cn(
              "pointer-events-none absolute inset-0 z-[4] bg-[radial-gradient(circle_at_50%_32%,rgba(228,40,49,0.16),transparent_62%)] transition-opacity duration-500",
              mirror.twinStatus === "developing" ||
                mirror.dressStatus === "dressing" ||
                scanLive
                ? "opacity-100"
                : "opacity-0",
            )}
          />
          {stageScanChrome}
        </div>
      </div>
    );
  }

  const statusLine =
    mirror.twinStatus === "developing"
      ? mirror.twinBuildPct >= 52
        ? "Printing now."
        : "Building your twin."
      : mirror.dressStatus === "dressing"
        ? "Dressing the twin."
        : mirror.developPct >= 100
          ? "That's your twin."
          : "Fills in as I go.";

  const barPct =
    mirror.twinStatus === "developing"
      ? Math.max(6, mirror.twinBuildPct)
      : mirror.developPct;

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-auto text-[var(--fitting-ink)]",
        layout === "column"
          ? "bg-gradient-to-b from-[#FAFAFB] to-[#F0F0F2] px-3.5 py-5"
          : "sticky top-0 h-[100dvh] px-[18px] py-5",
      )}
    >
      <div className="font-display text-[9.5px] font-extrabold tracking-[0.16em] text-[var(--fitting-quiet)]">
        YOUR TWIN
      </div>
      <p className="mb-3 mt-1 min-h-[30px] text-[11px] leading-[1.45] text-[#B0B0B8]">
        {statusLine}
      </p>

      <div
        ref={printRef}
        onMouseMove={onMove}
        className={cn(
          "relative min-h-0 flex-1 overflow-hidden rounded-2xl",
          "bg-[radial-gradient(70%_52%_at_50%_20%,#FFF,#F2F2F4_52%,#E2E2E6_100%)]",
        )}
      >
        <div
          className="fitting-motion pointer-events-none absolute inset-0 z-[6] opacity-0 transition-opacity duration-500"
          style={{
            opacity: mirror.foil ? 0.28 : 0,
            background:
              "radial-gradient(120% 90% at var(--mx,30%) var(--my,20%),rgba(255,255,255,.45) 0%,transparent 45%),conic-gradient(from 210deg at 50% 50%,#ffd5c8,#e8c7f0,#c3e7f6,#d9f6c3,#fff3c3,#ffd5c8)",
            filter: "saturate(0.8)",
          }}
        />
        <div
          className={cn(
            "pointer-events-none absolute inset-0 z-[4] bg-[radial-gradient(circle_at_50%_32%,rgba(228,40,49,0.16),transparent_62%)] transition-opacity duration-500",
            mirror.twinStatus === "developing" ||
              mirror.dressStatus === "dressing" ||
              mirror.scanActivity === "reading" ||
              mirror.scanActivity === "writing"
              ? "opacity-100"
              : "opacity-0",
          )}
        />
        {fillUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={fillUrl}
              src={fillUrl}
              alt=""
              className={cn(
                "absolute inset-0 size-full object-cover object-top",
                twinReady
                  ? "animate-[fitting-twin-in_0.7s_ease-out]"
                  : "scale-[1.02]",
                mirror.dressStatus === "dressing" &&
                  "animate-[fitting-blink_1.8s_infinite] opacity-90",
                mirror.twinStatus === "developing" &&
                  !twinReady &&
                  "animate-[fitting-blink_1.8s_infinite]",
              )}
            />
          </>
        ) : null}
        {mirror.scanActivity === "writing" ? (
          <FittingVerdictAnnotations compact={layout === "column"} />
        ) : null}
        <div className="absolute inset-0 z-[2] flex flex-col p-3">
          <div
            className={cn(
              "relative min-h-0 flex-1",
              layout === "column" ? "min-h-[120px]" : "min-h-[180px]",
            )}
          >
            {fillUrl ? null : twinFigure}
            {mirror.twinStatus === "developing" &&
            mirror.scanActivity !== "review" &&
            mirror.dressStatus !== "dressing" ? (
              <>
                <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden">
                  <i className="fitting-scan-line" />
                </div>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[6] px-0.5">
                  <div
                    className={cn(
                      "rounded-[12px] border border-[var(--fitting-line)] bg-white/92 shadow-[0_10px_22px_-14px_rgba(14,14,17,.45)] backdrop-blur-[2px]",
                      layout === "column" ? "px-2 py-1.5" : "px-2.5 py-2",
                    )}
                  >
                    <p className="font-display text-[11px] font-extrabold leading-none text-[var(--fitting-ink)]">
                      Building your twin
                    </p>
                    <p className="mt-1 text-[12px] leading-snug text-[var(--fitting-quiet)]">
                      {mirror.twinBuildLabel || "this takes about a minute"}
                    </p>
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--fitting-line)]">
                      <span
                        className="fitting-motion block h-full rounded-full bg-[var(--fitting-red)]"
                        style={{
                          width: `${Math.max(6, mirror.twinBuildPct)}%`,
                        }}
                      />
                    </div>
                    <p className="mt-1.5 text-[8.5px] font-extrabold tracking-[0.08em] text-[var(--fitting-quiet)]">
                      {mirror.twinBuildPct}%
                      {mirror.twinBuildElapsedSec > 0
                        ? ` · ${formatTwinClock(mirror.twinBuildElapsedSec)}`
                        : ""}
                      {" · keep answering"}
                    </p>
                  </div>
                </div>
              </>
            ) : mirror.scanActivity === "review" &&
              mirror.dressStatus !== "dressing" ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[6] px-0.5">
                <div
                  className={cn(
                    "rounded-[12px] border border-[var(--fitting-line)] bg-white/92 shadow-[0_10px_22px_-14px_rgba(14,14,17,.45)] backdrop-blur-[2px]",
                    layout === "column" ? "px-2 py-1.5" : "px-2.5 py-2",
                  )}
                >
                  <p className="font-display text-[11px] font-extrabold leading-none text-[var(--fitting-ink)]">
                    Confirming the scan
                  </p>
                  {mirror.scanNotes.length ? (
                    <ul className="mt-1.5 space-y-0.5">
                      {mirror.scanNotes.map((note) => (
                        <li
                          key={note.label}
                          className="flex justify-between gap-2 text-[8.5px] font-extrabold tracking-[0.04em] text-[var(--fitting-quiet)]"
                        >
                          <span>{note.label}</span>
                          <span className="max-w-[58%] truncate text-right text-[var(--fitting-ink)]">
                            {note.value}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-[12px] leading-snug text-[var(--fitting-quiet)]">
                      pause the sweep — check the reading, then lock it
                    </p>
                  )}
                </div>
              </div>
            ) : (mirror.scanActivity === "reading" ||
                mirror.scanActivity === "writing") &&
              mirror.dressStatus !== "dressing" ? (
              <>
                <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden">
                  <i className="fitting-scan-line" />
                  {mirror.scanNotes.slice(0, 4).map((note, i) => (
                    <div
                      key={note.label}
                      className={cn(
                        "shoop-sscan__anno lit",
                        `shoop-sscan__anno--${i + 1}`,
                      )}
                    >
                      {i % 2 === 1 ? <span className="tick" /> : null}
                      <span>
                        {note.label}
                        {note.value ? ` · ${note.value}` : ""}
                      </span>
                      {i % 2 === 0 ? <span className="tick" /> : null}
                    </div>
                  ))}
                </div>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[6] px-0.5">
                  <div
                    className={cn(
                      "rounded-[12px] border border-[var(--fitting-line)] bg-white/92 shadow-[0_10px_22px_-14px_rgba(14,14,17,.45)] backdrop-blur-[2px]",
                      layout === "column" ? "px-2 py-1.5" : "px-2.5 py-2",
                    )}
                  >
                    <p className="font-display text-[11px] font-extrabold leading-none text-[var(--fitting-ink)]">
                      {mirror.scanActivity === "writing"
                        ? "Writing your verdict"
                        : "Scanning your photo"}
                    </p>
                    <p className="mt-1 text-[12px] leading-snug text-[var(--fitting-quiet)]">
                      {mirror.scanActivity === "writing"
                        ? "on your twin — not a second picture"
                        : "one face, on this card"}
                    </p>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-1.5">
        {lines.map((line) => {
          const lit = line.value !== "—";
          return (
            <div
              key={line.id}
              className={cn(
                "fitting-motion flex justify-between border-t border-[var(--fitting-line)] py-1.5 text-[10.5px] transition-all duration-300",
                lit ? "translate-y-0 opacity-100" : "translate-y-1 opacity-40",
              )}
            >
              <span className="font-semibold text-[#B0B0B8]">{line.label}</span>
              <b
                className={cn(
                  "font-display font-extrabold",
                  line.red && lit
                    ? "text-[var(--fitting-red)]"
                    : "text-[var(--fitting-ink)]",
                )}
              >
                {line.value}
              </b>
            </div>
          );
        })}
      </div>

      {mirror.closetImages.some(Boolean) ? (
        <div className="mt-1.5 flex items-center gap-1.5">
          {mirror.closetImages.slice(0, 3).map((img, i) =>
            img ? (
              <span
                key={i}
                className="relative h-10 flex-1 overflow-hidden rounded-md"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img}
                  alt=""
                  className="absolute inset-0 size-full object-cover"
                />
              </span>
            ) : null,
          )}
        </div>
      ) : null}

      {mirror.twinStatus !== "idle" || mirror.dressStatus !== "idle" ? (
        <div
          className={cn(
            "mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[9px] font-bold tracking-[0.04em] text-[var(--fitting-quiet)]",
            (mirror.dressStatus === "ready" ||
              (mirror.dressStatus === "idle" &&
                mirror.twinStatus === "ready")) &&
              "text-[#2BB673]",
            (mirror.dressStatus === "error" || mirror.twinStatus === "error") &&
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
                ? (mirror.dressError ??
                  "dress failed — twin still here undressed")
                : mirror.twinStatus === "ready"
                  ? "twin ready"
                  : mirror.twinStatus === "error"
                    ? (mirror.twinError ?? "twin mint failed — print it again")
                    : mirror.twinBuildLabel
                      ? `${mirror.twinBuildLabel} · ${mirror.twinBuildPct}%`
                      : "Shoop is building your twin..."}
          {mirror.twinStatus === "error" && onRetryTwin ? (
            <button
              type="button"
              onClick={onRetryTwin}
              className="ml-auto border-0 border-b border-[var(--fitting-red)] bg-transparent p-0 font-sans text-[9px] font-extrabold tracking-[0.04em] text-[var(--fitting-red)]"
            >
              Print again
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="bar mt-2.5 h-1 overflow-hidden rounded-full bg-[var(--fitting-g3)]">
        <i
          className="fitting-motion block h-full rounded-full bg-[var(--fitting-red)]"
          style={{
            width: `${barPct}%`,
            transition: "width 0.7s cubic-bezier(.4,0,.2,1)",
          }}
        />
      </div>

      {onTell ? (
        <div className="mt-3">
          <div
            className={cn(
              "flex items-center gap-2 rounded-[13px] border-[1.5px] border-[var(--fitting-g3)] bg-white py-1.5 pl-3 pr-1.5",
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
                if (e.key !== "Enter") submitTell();
              }}
            />
            <button
              type="button"
              disabled={tellBusy}
              onClick={submitTell}
              className="h-[34px] rounded-[10px] bg-[var(--fitting-ink)] px-3.5 font-display text-[11.5px] font-extrabold text-white disabled:bg-[var(--fitting-g3)] disabled:text-[#A8A8B0]"
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
