"use client";

import { LEGAL_PATHS } from "@/lib/legal/constants";
import Link from "next/link";

export function ShareLikenessDialog({
  open,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal
      aria-labelledby="share-likeness-title"
    >
      <div className="w-full max-w-md rounded-[22px] border border-[var(--fitting-line)] bg-white p-5 shadow-[0_24px_50px_-20px_rgba(14,14,17,0.45)]">
        <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-[var(--fitting-red)]">
          FIRST SHARE
        </p>
        <h2
          id="share-likeness-title"
          className="mt-2 font-display text-[22px] font-extrabold tracking-tight text-[var(--fitting-ink)]"
        >
          You&apos;re about to send a realistic image of you.
        </h2>
        <p className="mt-3 text-[14px] leading-[1.55] text-[#3A3A44]">
          They don&apos;t need an account to see it. The link expires in 7 days
          and you can revoke it any time from Shared cards. Anyone with the
          link can see this render of you — not your measurements.
        </p>
        <p className="mt-2 text-[12.5px] text-[var(--fitting-quiet)]">
          Read the{" "}
          <Link
            href={LEGAL_PATHS.sharing}
            target="_blank"
            className="font-semibold text-[var(--fitting-ink)] underline underline-offset-2"
          >
            Sharing Policy
          </Link>
          .
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="h-11 rounded-[12px] bg-[var(--fitting-ink)] px-4 text-[13px] font-extrabold text-white disabled:opacity-50"
          >
            {busy ? "Saving…" : "Send it"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="h-11 rounded-[12px] px-4 text-[13px] font-extrabold text-[var(--fitting-quiet)]"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
