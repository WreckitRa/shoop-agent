"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/ai-chat/cn";

export function ScanKick({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 font-display text-[10.5px] font-extrabold tracking-[0.14em] text-[var(--fitting-red)]">
      <i className="size-1.5 shrink-0 rounded-full bg-[var(--fitting-red)]" />
      {children}
    </div>
  );
}

export function ScanCard({
  title,
  badge,
  badgeTone = "ink",
  children,
  className,
}: {
  title: string;
  badge?: ReactNode;
  badgeTone?: "ink" | "red" | "quiet" | "good" | "watch";
  children: ReactNode;
  className?: string;
}) {
  const tone =
    badgeTone === "red"
      ? "text-[var(--fitting-red)]"
      : badgeTone === "good"
        ? "text-[var(--fitting-good)]"
        : badgeTone === "watch"
          ? "text-[var(--fitting-watch)]"
          : badgeTone === "quiet"
            ? "text-[var(--fitting-quiet)]"
            : "text-[var(--fitting-ink)]";
  return (
    <div
      className={cn(
        "mb-3 min-w-0 rounded-[14px] border border-[var(--fitting-line)] bg-white p-3.5 last:mb-0",
        className,
      )}
    >
      <div className="mb-2.5 flex items-start justify-between gap-2 font-display text-[10px] font-extrabold tracking-[0.14em] text-[var(--fitting-quiet)]">
        <span className="min-w-0 leading-tight">{title}</span>
        {badge != null ? (
          <b className={cn("font-extrabold", tone)}>{badge}</b>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function ConfPill({ n }: { n: number }) {
  const band = n >= 0.75 ? "hi" : n >= 0.55 ? "md" : "lo";
  const cls =
    band === "hi"
      ? "bg-[rgba(22,163,74,.12)] text-[var(--fitting-good)]"
      : band === "md"
        ? "bg-[rgba(201,138,14,.14)] text-[var(--fitting-watch)]"
        : "bg-[rgba(228,40,49,.1)] text-[var(--fitting-red)]";
  return (
    <span
      className={cn(
        "shrink-0 rounded-[6px] px-[7px] py-1 font-mono text-[9.5px] font-semibold",
        cls,
      )}
    >
      {n <= 0 ? "0%" : `${Math.round(n * 100)}%`}
    </span>
  );
}

export function ScanRow({
  label,
  evidence,
  value,
  sub,
  confidence,
  patch,
  trailing,
  tone = "display",
}: {
  label: string;
  evidence?: string;
  value: ReactNode;
  sub?: ReactNode;
  confidence?: number;
  patch?: string | null;
  trailing?: ReactNode;
  tone?: "display" | "body";
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 border-t border-[var(--fitting-line)] py-2.5 first:border-t-0 first:pt-0">
      <div className="flex items-start gap-2">
        {patch ? (
          <span
            className="mt-0.5 size-6 shrink-0 rounded-md shadow-[inset_0_0_0_1px_rgba(14,14,17,.1)]"
            style={{ background: patch }}
          />
        ) : null}
        <span className="min-w-0 flex-1 text-[11px] font-bold leading-tight">
          {label}
          {evidence ? (
            <em className="mt-0.5 block text-[10px] font-medium not-italic leading-[1.35] text-[var(--fitting-quiet)]">
              {evidence}
            </em>
          ) : null}
        </span>
        {confidence != null ? <ConfPill n={confidence} /> : null}
        {trailing}
      </div>
      <span
        className={
          tone === "body"
            ? "min-w-0 break-words text-[13px] font-semibold leading-[1.45] tracking-normal"
            : "min-w-0 break-words font-display text-[16px] font-black leading-[1.25] tracking-[-0.02em]"
        }
      >
        {value}
        {sub ? (
          <small className="mt-[3px] block font-mono text-[10px] font-normal tracking-normal text-[var(--fitting-quiet)]">
            {sub}
          </small>
        ) : null}
      </span>
    </div>
  );
}

export function ScanWarn({ children }: { children: ReactNode }) {
  return (
    <div className="mt-2.5 rounded-[12px] border border-[#F0C9CC] bg-[#FFFCFC] px-3 py-3 text-[12px] leading-[1.55] text-[#B3454C]">
      {children}
    </div>
  );
}

export type PipeKind = "ok" | "no" | "wn";

export function ScanPipe({
  lines,
}: {
  lines: Array<{ text: ReactNode; kind?: PipeKind }>;
}) {
  if (!lines.length) return null;
  return (
    <div className="mt-2.5 max-h-[140px] overflow-auto font-mono text-[10px] leading-[1.75] text-[var(--fitting-quiet)]">
      {lines.map((line, i) => (
        <div key={i} className="flex gap-2">
          <span
            className={cn(
              "w-[11px] shrink-0",
              line.kind === "no"
                ? "text-[var(--fitting-red)]"
                : line.kind === "wn"
                  ? "text-[var(--fitting-watch)]"
                  : "text-[var(--fitting-good)]",
            )}
          >
            {line.kind === "no" ? "✕" : line.kind === "wn" ? "!" : "✓"}
          </span>
          <span className="[&_b]:font-semibold [&_b]:text-[var(--fitting-ink)]">
            {line.text}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ScanStage({
  src,
  scanning,
  children,
  size = "frame",
}: {
  src?: string | null;
  scanning?: boolean;
  children?: ReactNode;
  size?: "frame" | "drop";
}) {
  return (
    <div
      className={
        size === "drop"
          ? "relative mx-auto grid aspect-[3/4] w-full max-w-[240px] place-items-center overflow-hidden rounded-[12px] bg-[#EDEDF1]"
          : "relative mx-auto grid aspect-[3/4] w-full max-w-[168px] place-items-center overflow-hidden rounded-[12px] bg-[#EDEDF1]"
      }
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          className="absolute inset-0 size-full object-contain"
        />
      ) : null}
      {scanning ? <div className="fitting-scan-line" /> : null}
      {children}
    </div>
  );
}

export function ScanRule({
  yes,
  doText,
  why,
}: {
  yes: boolean;
  doText: string;
  why?: string;
}) {
  return (
    <div className="mt-2 flex gap-2.5 border-t border-[var(--fitting-line)] pt-2.5">
      <b
        className={cn(
          "shrink-0 font-display",
          yes ? "text-[var(--fitting-good)]" : "text-[var(--fitting-red)]",
        )}
      >
        {yes ? "✓" : "✕"}
      </b>
      <div className="min-w-0 text-[13px] leading-[1.5]">
        <b>{doText}</b>
        {why ? (
          <div className="mt-[3px] text-[13px] text-[var(--fitting-quiet)]">
            {why}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ScanSection({
  kick,
  headline,
  body,
  children,
}: {
  kick: string;
  headline?: string;
  body?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mt-4 first:mt-0">
      <div className="font-display text-[10.5px] font-extrabold tracking-[0.16em] text-[var(--fitting-red)]">
        {kick}
      </div>
      {headline ? (
        <div className="my-1.5 font-display text-[18px] font-black leading-[1.15] tracking-[-0.02em]">
          {headline}
        </div>
      ) : null}
      {body ? (
        <div className="text-[13.5px] leading-[1.6] text-[#3A3A44]">{body}</div>
      ) : null}
      {children}
    </div>
  );
}

export function isHexColor(value: string | null | undefined): value is string {
  return Boolean(value && /^#([0-9a-fA-F]{6})$/.test(value));
}
