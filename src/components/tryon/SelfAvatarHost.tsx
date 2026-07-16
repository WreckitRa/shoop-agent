"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { AvatarStepper } from "@/components/tryon/AvatarStepper";
import { useSelfAvatarStore } from "@/components/tryon/self-avatar-store";

/**
 * Boots self-avatar readiness for the session and hosts the create/update
 * stepper so curation CTAs can flip after the user finishes an avatar.
 */
export function SelfAvatarHost() {
  const status = useSelfAvatarStore((s) => s.status);
  const personId = useSelfAvatarStore((s) => s.personId);
  const createFlowOpen = useSelfAvatarStore((s) => s.createFlowOpen);
  const refresh = useSelfAvatarStore((s) => s.refresh);
  const closeCreateFlow = useSelfAvatarStore((s) => s.closeCreateFlow);
  const markReady = useSelfAvatarStore((s) => s.markReady);

  const [mounted, setMounted] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (status === "unknown") void refresh();
  }, [status, refresh]);

  useEffect(() => {
    if (!createFlowOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !avatarBusy) closeCreateFlow();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [createFlowOpen, avatarBusy, closeCreateFlow]);

  if (!mounted || !createFlowOpen || !personId) return null;

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-end justify-center p-4 sm:items-center">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-ink/45 backdrop-blur-md"
        onClick={() => {
          if (!avatarBusy) closeCreateFlow();
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="self-avatar-flow-title"
        className="relative z-10 flex max-h-[min(92vh,760px)] w-full max-w-lg flex-col overflow-hidden rounded-[28px] border border-hairline bg-white shadow-[0_24px_64px_rgba(12,12,12,0.18)]"
      >
        <div className="flex items-center justify-between border-b border-hairline-soft px-5 py-4 sm:px-6">
          <h2
            id="self-avatar-flow-title"
            className="font-serif text-lg font-semibold text-ink"
          >
            Create your avatar
          </h2>
          <button
            type="button"
            onClick={() => {
              if (!avatarBusy) closeCreateFlow();
            }}
            disabled={avatarBusy}
            aria-label="Close"
            className="inline-flex size-8 items-center justify-center rounded-lg text-ink-muted transition hover:bg-surface-subtle hover:text-ink disabled:opacity-40"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-5 sm:px-6">
          {avatarBusy ? (
            <p className="mb-3 text-xs text-ink-muted">
              Hang tight — closing now would interrupt your avatar.
            </p>
          ) : null}

          <AvatarStepper
            key={personId}
            personId={personId}
            personLabel="You"
            onBusyChange={setAvatarBusy}
            onComplete={() => {
              markReady();
              void refresh();
              closeCreateFlow();
            }}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
