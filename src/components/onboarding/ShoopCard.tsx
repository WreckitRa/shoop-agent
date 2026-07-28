"use client";

import { useEffect, useState } from "react";
import { ImagePlus } from "lucide-react";
import { cn } from "@/lib/ai-chat/cn";
import { removeImageBackground } from "@/lib/client/remove-image-background";
import type { StyleMix } from "@/lib/onboarding/style-mix";
import type { BuildBand, MuscularityBand } from "@/lib/tryon/types";

export type ShoopCardState = {
  preferredName: string;
  eraLabel: string;
  styleMix: StyleMix;
  heightCm: number | null;
  build: BuildBand | null;
  muscularity: MuscularityBand | null;
  /** 0–100 clarity ladder */
  clarity: number;
  /** Live preview stretch (height slider before lock) */
  previewHeightCm?: number | null;
  previewBuild?: BuildBand | null;
  minted: boolean;
  avatarUrl?: string | null;
  faceReady: boolean;
  serial: string;
  syncScore: number;
  mintBeat?: 0 | 1 | 2 | 3 | 4;
};

const BUILD_SHORT: Record<BuildBand, string> = {
  slim: "SLIM",
  average: "AVG",
  athletic: "ATHL",
  broad: "BROAD",
  plus: "PLUS",
};

const MUSCLE_SHORT: Record<MuscularityBand, string> = {
  low: "SOFT",
  moderate: "TONED",
  high: "DEF",
};

const BUILD_WIDTH: Record<BuildBand, number> = {
  slim: 48,
  average: 56,
  athletic: 62,
  broad: 68,
  plus: 74,
};

function fogFromClarity(c: number): number {
  if (c >= 100) return 0;
  if (c >= 85) return 0.12;
  if (c >= 70) return 0.25;
  if (c >= 50) return 0.4;
  if (c >= 30) return 0.55;
  return 0.75;
}

function blurFromClarity(c: number): number {
  if (c >= 100) return 0;
  if (c >= 85) return 0.6;
  if (c >= 70) return 1.5;
  if (c >= 50) return 3;
  if (c >= 30) return 5;
  return 8;
}

function satFromClarity(c: number): number {
  if (c >= 100) return 1.05;
  if (c >= 85) return 1;
  if (c >= 70) return 0.9;
  if (c >= 50) return 0.8;
  if (c >= 30) return 0.65;
  return 0.45;
}

function opFromClarity(c: number): number {
  if (c >= 100) return 1;
  if (c >= 85) return 1;
  if (c >= 70) return 0.95;
  if (c >= 50) return 0.88;
  if (c >= 30) return 0.78;
  return 0.62;
}

function heightFillPct(cm: number | null): number {
  if (cm == null) return 0;
  return Math.max(8, Math.min(100, ((cm - 140) / (210 - 140)) * 100));
}

function buildFillPct(build: BuildBand | null): number {
  if (!build) return 0;
  const order: BuildBand[] = ["slim", "average", "athletic", "broad", "plus"];
  return ((order.indexOf(build) + 1) / order.length) * 100;
}

function muscleFillPct(m: MuscularityBand | null): number {
  if (!m) return 0;
  if (m === "low") return 35;
  if (m === "moderate") return 70;
  return 95;
}

function shortEra(label: string): string {
  const parts = label.split("·");
  const tail = (parts[1] ?? parts[0] ?? label).trim();
  return tail.replace(/\s+era$/i, "").toUpperCase() || "ERA";
}

function flavorCopy(state: ShoopCardState): string {
  if (state.minted) {
    const heading = state.styleMix.headingToward;
    return heading
      ? `"Dresses who they are. Becoming more ${heading}. Truth the whole way."`
      : `"Out of the fog. First edition. Yours."`;
  }
  if (state.clarity >= 85) return `"Four of four. Mint them."`;
  if (state.clarity >= 70) return `"Almost out of the fog now."`;
  if (state.clarity >= 50) return `"Halfway out of the fog."`;
  if (state.clarity >= 30) return `"The face is in. Now the frame."`;
  return `"Every card starts in the fog. Yours is already clearing."`;
}

function moveCopy(state: ShoopCardState): { title: string; body: string } {
  if (state.minted) {
    const heading = state.styleMix.headingToward ?? "Effortless";
    const pct = state.styleMix.headingPercent ?? 25;
    return {
      title: `SIGNATURE MOVE — ${heading.toUpperCase()} EVOLUTION`,
      body: `This card is evolving: +${pct}% ${heading}. Next form unlocks as Shoop learns.`,
    };
  }
  if (state.clarity >= 85) {
    return {
      title: "SIGNATURE MOVE — READY TO UNLOCK",
      body: "The atelier does the last 15%.",
    };
  }
  if (state.clarity >= 70) {
    return {
      title: "SIGNATURE MOVE — LOCKED",
      body: "One answer from the atelier.",
    };
  }
  return {
    title: "SIGNATURE MOVE — LOCKED",
    body: "Every answer clears the fog. Keep going.",
  };
}

type Props = {
  state: ShoopCardState;
  className?: string;
  compact?: boolean;
  /** When set (photo step), art area becomes a dashed drop / click target. */
  onPhotoSelect?: () => void;
  onPhotoFile?: (file: File) => void;
  photoBusy?: boolean;
};

export function ShoopCard({
  state,
  className,
  compact,
  onPhotoSelect,
  onPhotoFile,
  photoBusy,
}: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [cutoutUrl, setCutoutUrl] = useState<string | null>(null);
  const [cutoutBusy, setCutoutBusy] = useState(false);

  useEffect(() => {
    if (!state.minted || !state.avatarUrl) {
      setCutoutUrl(null);
      setCutoutBusy(false);
      return;
    }
    const src = state.avatarUrl;
    let cancelled = false;
    setCutoutBusy(true);
    // Don't abort mid-job — cancel only skips applying; cache still fills.
    void removeImageBackground(src)
      .then((url) => {
        if (!cancelled) setCutoutUrl(url);
      })
      .catch(() => {
        if (!cancelled) setCutoutUrl(null);
      })
      .finally(() => {
        if (!cancelled) setCutoutBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [state.minted, state.avatarUrl]);

  const heightCm = state.previewHeightCm ?? state.heightCm;
  const build = state.previewBuild ?? state.build;
  const fog = fogFromClarity(state.clarity);
  const blur = blurFromClarity(state.clarity);
  const sat = satFromClarity(state.clarity);
  const op = opFromClarity(state.clarity);
  const torsoH =
    heightCm != null
      ? Math.round(72 + ((heightCm - 150) / 60) * 28)
      : 88;
  const torsoW = build ? Math.round(BUILD_WIDTH[build] * 0.92) : 52;
  const headSize = 28;
  const figureH = headSize + 4 + torsoH;
  const artH = state.minted && state.avatarUrl
    ? compact
      ? 148
      : 200
    : compact
      ? 120
      : 168;
  const figureScale = Math.min(1, (artH - 20) / figureH);
  const solid = Boolean(state.muscularity) || state.clarity >= 85;
  const showOutfit = state.minted || (state.mintBeat != null && state.mintBeat >= 3);
  const minting = Boolean(
    !state.minted && state.mintBeat != null && state.mintBeat > 0,
  );
  const move = moveCopy(state);
  const axes = state.styleMix.axes.slice(0, 3);
  const displayName = state.minted
    ? (state.preferredName.trim().split(/\s+/)[0] || "YOU").toUpperCase()
    : "UNCLAIMED";
  const era = state.minted
    ? shortEra(state.eraLabel || "Prime")
    : "UNMINTED";

  const showPhotoDrop =
    Boolean(onPhotoSelect || onPhotoFile) && !state.faceReady && !state.minted;

  function acceptFile(file: File | undefined | null) {
    if (!file || !onPhotoFile) return;
    if (!file.type.startsWith("image/")) return;
    onPhotoFile(file);
  }

  return (
    <div
      className={cn(
        "relative w-full max-w-[270px] shrink-0 overflow-hidden rounded-[18px] shadow-[0_22px_48px_-20px_rgba(26,26,46,0.5)]",
        compact ? "aspect-[5/6.2]" : "aspect-[5/7]",
        className,
      )}
    >
      {state.minted ? (
        <div
          className="pointer-events-none absolute inset-0 z-10 rounded-[18px] opacity-40 mix-blend-soft-light"
          style={{
            background:
              "radial-gradient(120% 90% at 30% 20%, rgba(255,255,255,0.35) 0%, transparent 45%), conic-gradient(from 210deg at 50% 50%, #f6d5c3, #e8c7f0, #c3e7f6, #d9f6c3, #f6ecc3, #f6d5c3)",
            // Keep foil off the portrait window so the cutout stays crisp
            maskImage:
              "linear-gradient(#000 0%, #000 18%, transparent 22%, transparent 52%, #000 58%)",
            WebkitMaskImage:
              "linear-gradient(#000 0%, #000 18%, transparent 22%, transparent 52%, #000 58%)",
          }}
          aria-hidden
        />
      ) : null}

      <div
        className={cn(
          "absolute inset-0 flex flex-col overflow-hidden rounded-[18px] border border-[#35354a] p-3.5 text-[#EDEAF2]",
          state.minted
            ? "bg-[linear-gradient(165deg,#171725_0%,#232338_55%,#4a3a2c_130%)]"
            : "bg-[linear-gradient(170deg,#1b1b26_0%,#232330_60%,#2a2a3a_130%)]",
        )}
      >
        <div className="flex justify-between">
          <div>
            <div
              className={cn(
                "text-[15px] font-black tracking-tight",
                state.minted ? "text-white" : "text-[#6f6a80]",
              )}
            >
              {displayName}
            </div>
            <span
              className={cn(
                "mt-1 inline-block rounded-full border px-2 py-0.5 text-[7px] font-extrabold tracking-[0.13em]",
                state.minted
                  ? "border-[#C8A96A] text-[#E8D9B0]"
                  : "border-[#4a4a5e] text-[#8f8798]",
              )}
            >
              {era}
            </span>
          </div>
          <div className="text-right text-[7.5px] font-extrabold tracking-[0.13em] text-[#8f8798]">
            SYNC
            <b className="mt-0.5 block text-[14px] text-[#c9c4d4]">
              {state.faceReady || state.minted ? state.syncScore : "??"}
            </b>
          </div>
        </div>

        <div
          className={cn(
            "relative my-2 overflow-hidden rounded-xl",
            state.minted && state.avatarUrl
              ? compact
                ? "h-[148px]"
                : "h-[176px] sm:h-[200px]"
              : state.avatarUrl && minting
                ? compact
                  ? "h-[148px]"
                  : "h-[176px] sm:h-[200px]"
              : compact
                ? "h-[120px]"
                : "h-[148px] sm:h-[168px]",
            showPhotoDrop
              ? cn(
                  "border-2 border-dashed transition-colors",
                  dragOver
                    ? "border-[#E8D9B0] bg-[rgba(232,217,176,0.12)]"
                    : "border-[#6b6478] bg-[radial-gradient(ellipse_at_50%_40%,#2a2a3a_0%,#191922_75%)]",
                  !photoBusy && "cursor-pointer hover:border-[#C8A96A] hover:bg-[rgba(200,169,106,0.08)]",
                )
              : cn(
                  "border border-[#3a3a50]",
                  state.minted
                    ? "bg-[radial-gradient(ellipse_at_50%_15%,#5a5a7d_0%,#20202f_75%)]"
                    : "bg-[radial-gradient(ellipse_at_50%_18%,#33334a_0%,#191922_72%)]",
                ),
          )}
          role={showPhotoDrop ? "button" : undefined}
          tabIndex={showPhotoDrop && !photoBusy ? 0 : undefined}
          aria-label={showPhotoDrop ? "Drop a selfie or click to upload" : undefined}
          onClick={() => {
            if (!showPhotoDrop || photoBusy) return;
            onPhotoSelect?.();
          }}
          onKeyDown={(e) => {
            if (!showPhotoDrop || photoBusy) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onPhotoSelect?.();
            }
          }}
          onDragEnter={(e) => {
            if (!showPhotoDrop || photoBusy) return;
            e.preventDefault();
            e.stopPropagation();
            setDragOver(true);
          }}
          onDragOver={(e) => {
            if (!showPhotoDrop || photoBusy) return;
            e.preventDefault();
            e.stopPropagation();
            setDragOver(true);
          }}
          onDragLeave={(e) => {
            if (!showPhotoDrop) return;
            e.preventDefault();
            e.stopPropagation();
            setDragOver(false);
          }}
          onDrop={(e) => {
            if (!showPhotoDrop || photoBusy) return;
            e.preventDefault();
            e.stopPropagation();
            setDragOver(false);
            acceptFile(e.dataTransfer.files?.[0]);
          }}
        >
          {state.avatarUrl && (state.minted || minting) ? (
            <>
              <div
                className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_35%,#3a3a52_0%,#1a1a26_75%)]"
                aria-hidden
              />
              {state.minted && cutoutUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={cutoutUrl}
                  alt=""
                  className="absolute inset-0 size-full object-contain object-bottom brightness-105 contrast-110"
                />
              ) : state.minted ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                  <span className="size-7 animate-pulse rounded-full border-2 border-[#C8A96A]/40 border-t-[#E8D9B0]" />
                  <span className="text-[7.5px] font-bold tracking-[0.12em] text-[#c9c4d4]">
                    {cutoutBusy ? "CLEARING STUDIO…" : "LOADING…"}
                  </span>
                </div>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={state.avatarUrl}
                  alt=""
                  className="absolute inset-0 size-full object-contain object-bottom"
                />
              )}
              {state.minted ? (
                <span className="absolute left-2 top-1.5 z-[2] text-[6.5px] font-black tracking-[0.15em] text-white/90 drop-shadow">
                  FIRST EDITION
                </span>
              ) : null}
            </>
          ) : showPhotoDrop ? (
            <div className="absolute inset-0 z-[2] flex flex-col items-center justify-center gap-1.5 px-3 text-center">
              <span
                className={cn(
                  "flex size-10 items-center justify-center rounded-full border border-dashed",
                  dragOver
                    ? "border-[#E8D9B0] text-[#E8D9B0]"
                    : "border-[#8f8798] text-[#c9c4d4]",
                )}
              >
                <ImagePlus className="size-5" strokeWidth={1.75} aria-hidden />
              </span>
              <span className="text-[9px] font-extrabold tracking-[0.12em] text-[#EDEAF2]">
                {photoBusy
                  ? "UPLOADING…"
                  : dragOver
                    ? "DROP IT"
                    : "DROP SELFIE"}
              </span>
              <span className="text-[7.5px] font-semibold leading-snug text-[#8f8798]">
                {photoBusy
                  ? "Hang tight"
                  : "Drag a photo here, or tap to browse"}
              </span>
            </div>
          ) : (
            <>
              {minting ? (
                <div className="pointer-events-none absolute inset-0 z-[3] flex items-center justify-center bg-[rgba(18,18,28,0.35)]">
                  <span className="size-6 animate-spin rounded-full border-2 border-[#C8A96A]/30 border-t-[#E8D9B0]" />
                </div>
              ) : null}
              <div
                className="absolute inset-0 z-[1] flex items-end justify-center pb-2 pt-3"
              >
                <div
                  className="flex origin-bottom flex-col items-center transition-all duration-300"
                  style={{
                    filter: `blur(${blur}px) saturate(${sat})`,
                    opacity: op,
                    transform: `scale(${figureScale})`,
                  }}
                >
                  <div
                    className={cn(
                      "mx-auto mb-1 overflow-hidden rounded-full border-[1.4px]",
                      state.faceReady
                        ? "border-[#d8cfc2] bg-[linear-gradient(160deg,#d8cfc2,#b9aa97)]"
                        : "border-dashed border-[#6b6478] bg-transparent",
                    )}
                    style={{ width: headSize, height: headSize }}
                  />
                  <div
                    className={cn(
                      "relative rounded-[26px_26px_8px_8px] border-[1.4px] transition-all duration-300",
                      solid
                        ? "border-transparent bg-[linear-gradient(180deg,#8d8298_0%,#6a6178_100%)]"
                        : "border-dashed border-[#6b6478]",
                    )}
                    style={{ width: torsoW, height: torsoH }}
                  >
                    {showOutfit ? (
                      <div className="absolute inset-0 overflow-hidden rounded-[26px_26px_8px_8px]">
                        <div className="absolute inset-x-0 bottom-0 top-[13%] bg-[linear-gradient(180deg,#23305f_0%,#1d2850_62%,#14141f_100%)]" />
                        <div className="absolute left-1/2 top-[9%] h-[11px] w-[26px] -translate-x-1/2 rounded-[0_0_9px_9px] bg-[#F0E9DC]" />
                        <div className="absolute bottom-[32%] right-[-5px] h-[23px] w-[15px] rounded-[5px] bg-[linear-gradient(160deg,#E42831,#a91620)]" />
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
              <div
                className="pointer-events-none absolute inset-0 z-[2] transition-opacity duration-500"
                style={{
                  background: `radial-gradient(ellipse at 50% 60%, rgba(35,35,48,${fog * 0.85}) 0%, rgba(25,25,34,${fog}) 80%)`,
                }}
              />
            </>
          )}
          <span className="pointer-events-none absolute bottom-1.5 left-2 z-[3] text-[7px] font-black tracking-[0.13em] text-[#8f8798]">
            CLARITY{" "}
            <b className="text-[#EAD9C4]">{Math.round(state.clarity)}%</b>
          </span>
        </div>

        <div className="flex flex-col gap-1 text-[7.5px] font-extrabold tracking-[0.09em]">
          {axes.map((axis) => (
            <TraitRow
              key={axis.label}
              name={axis.label.toUpperCase()}
              lit
              fill={axis.percent}
              val={String(axis.percent)}
            />
          ))}
          <TraitRow
            name="HEIGHT"
            lit={state.heightCm != null}
            fill={heightFillPct(state.heightCm)}
            val={state.heightCm != null ? String(Math.round(state.heightCm)) : "—"}
          />
          <TraitRow
            name="BUILD"
            lit={state.build != null}
            fill={buildFillPct(state.build)}
            val={state.build ? BUILD_SHORT[state.build] : "—"}
          />
          <TraitRow
            name="DEFINITION"
            lit={state.muscularity != null}
            fill={muscleFillPct(state.muscularity)}
            val={state.muscularity ? MUSCLE_SHORT[state.muscularity] : "—"}
          />
        </div>

        <div
          className={cn(
            "mt-1.5 rounded-lg border px-2 py-1.5 text-[7.5px] leading-snug text-[#8f8798]",
            state.minted ? "border-[#C8A96A55] text-[#EAD9C4]" : "border-[#3a3a50]",
          )}
        >
          <b className="text-[8px]">{move.title}</b>
          <br />
          {move.body}
        </div>

        <div
          className={cn(
            "mt-1.5 font-serif text-[8.5px] italic leading-snug text-[#8f8798]",
            state.minted && "text-[#EAD9C4]",
          )}
        >
          {flavorCopy(state)}
        </div>

        <div className="mt-auto flex items-end justify-between pt-2 text-[5.5px] font-extrabold tracking-[0.1em] text-[#6f6a80]">
          <span className="text-[10px] text-[#EDEAF2]">SHOOP</span>
          <span className="text-right leading-tight">
            № {state.minted ? state.serial : "??????"} · FIRST EDITION · S/S 2026
            {state.minted ? (
              <>
                <br />
                WHAT&apos;S YOURS? SHOOP.WORLD
              </>
            ) : null}
          </span>
        </div>
      </div>
    </div>
  );
}

function TraitRow({
  name,
  lit,
  fill,
  val,
}: {
  name: string;
  lit?: boolean;
  fill: number;
  val: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5",
        lit ? "text-[#EDEAF2]" : "text-[#8f8798]",
      )}
    >
      <span className="w-14 shrink-0 truncate">{name}</span>
      <span className="h-[5px] min-w-0 flex-1 overflow-hidden rounded-full bg-[rgba(128,128,150,0.22)]">
        {fill > 0 ? (
          <span
            className="block h-full rounded-full bg-[linear-gradient(90deg,#C8A96A,#E8D9B0)] transition-[width] duration-500"
            style={{ width: `${Math.min(100, fill)}%` }}
          />
        ) : null}
      </span>
      <span className="w-8 shrink-0 text-right text-[8px]">{val}</span>
    </div>
  );
}

/** Deterministic stub serial from person id. */
export function stubSerialFromId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const n = (h % 900000) + 1;
  return String(n).padStart(6, "0");
}
